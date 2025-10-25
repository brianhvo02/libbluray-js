import { useRef, useState } from 'react';
import './App.scss';
import { Backdrop, Button, Card, CardActions, CardContent, Link, Typography } from '@mui/material';
import { get, set } from 'idb-keyval';
import { transfer } from 'comlink';
import workerUrl from 'libass-wasm/dist/js/subtitles-octopus-worker.js?url';

// @ts-expect-error SubtitlesOctopus has no types
import SubtitlesOctopus from 'libass-wasm';

const SAMPLE_RATE = 48000;
const DURATION = 1436.105;
const CHANNELS = 2;

const fileSystemAPIFullSupport = !!window.showOpenFilePicker;

const { openFile } = new ComlinkWorker<typeof import('./workers/demuxer')>(
    new URL('./workers/demuxer', import.meta.url), { type: 'module' }
);

const { render } = new ComlinkWorker<typeof import('./workers/renderer')>(
    new URL('./workers/renderer', import.meta.url), { type: 'module' }
);

const getInputFile = () => new Promise<File>((resolve, reject) => {
    const inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.onchange = function() {
        if (inputEl.files)
            resolve(inputEl.files[0]);
        else reject('No files selected.');
    }
    inputEl.oncancel = function() {
        reject('File selection canceled.');
    }
    inputEl.click();
});

const getFilePicker = async function() {
    const file = await get<FileSystemFileHandle>('m2ts');
    const state = await file?.requestPermission();

    if (state !== 'granted') {
        const [file] = await showOpenFilePicker();
        await set('m2ts', file);
        return file.getFile();
    }
    
    return file!.getFile();
}

const App = function() {
    const [ready, setReady] = useState(false);
    const rendererEl = useRef<HTMLCanvasElement>(null);
    const subtitleEl = useRef<HTMLCanvasElement>(null);
    const audioCtx = useRef<AudioContext | null>(null);
    const instance = useRef<unknown>(null);

    const getSubsFolder = async () => {
        const dhOld = await get<FileSystemDirectoryHandle>('subsDir');
        const dh = dhOld ?? await showDirectoryPicker();
        if (!dhOld)
            await set('subsDir', dh);
        const attachmentsDir = await dh.getDirectoryHandle('attachments');
        const fonts = await Array.fromAsync(attachmentsDir.values())
            .then(files => Promise.all(files.map(async fh => {
                if (fh instanceof FileSystemDirectoryHandle)
                    return '';

                const file = await fh.getFile();
                return URL.createObjectURL(file);
            })));
        const subsFh = await dh.getFileHandle('track4.eng.ass');
        const subsFile = await subsFh.getFile();
        const subUrl = URL.createObjectURL(subsFile);

        instance.current = new SubtitlesOctopus({
            canvas: subtitleEl.current,
            subUrl, fonts, workerUrl,
        });
    }

    const getFile = () => (fileSystemAPIFullSupport ? getFilePicker : getInputFile)()
        .then(async file => {
            if (!file) return false;

            const canvas = rendererEl.current?.transferControlToOffscreen();
            if (!canvas) return false;

            const demuxChannel = new MessageChannel();
            const renderChannel = new MessageChannel();

            audioCtx.current = new AudioContext();
            const audioBuf = audioCtx.current.createBuffer(CHANNELS, SAMPLE_RATE * DURATION, SAMPLE_RATE);
            const channelBufs = [...Array(CHANNELS).keys()].map(i => audioBuf.getChannelData(i));
            const source = audioCtx.current.createBufferSource();
            source.buffer = audioBuf;
            source.loop = true;
            source.connect(audioCtx.current.destination);

            render(
                transfer(canvas, [canvas]), 
                transfer(renderChannel.port2, [renderChannel.port2])
            );

            renderChannel.port1.onmessage = () => {
                const time = audioCtx.current ? audioCtx.current.currentTime : 0;
                if (instance.current)
                    (instance.current as { setCurrentTime: (arg0: number) => void }).setCurrentTime(time);
                renderChannel.port1.postMessage(time);
            };

            let start = false;
            demuxChannel.port1.onmessage = function(e: MessageEvent<{
                data: Float32Array | VideoFrame;
                timestamp?: number;
                audioOffset?: number;
            }>) {
                const { timestamp, audioOffset, data } = e.data;
                if (data instanceof VideoFrame) {
                    renderChannel.port1.postMessage(data, [data]);
                } else {
                    if (typeof audioOffset !== 'number' || !timestamp || !audioCtx.current) return;
                    
                    data.forEach((val, i) => {
                        channelBufs[i % CHANNELS][
                            (audioOffset + Math.floor(i / 2)) % (SAMPLE_RATE * DURATION)
                        ] = val;
                    });

                    if (!start) {
                        renderChannel.port1.postMessage(timestamp);
                        source.start();
                        setReady(true);
                        start = true;
                    }
                }
            }
            
            return openFile(file, transfer(demuxChannel.port2, [demuxChannel.port2]));
        });

    return (<>
        <Backdrop
            sx={(theme) => ({ color: '#fff', zIndex: theme.zIndex.drawer + 1 })}
            open={!ready}
        >
            <Card sx={{ minWidth: 275 }}>
                <CardContent>
                    <Typography gutterBottom sx={{ color: 'text.secondary', fontSize: 14 }}>
                        Based on <Link href="https://www.videolan.org/developers/libbluray.html">libbluray</Link>
                    </Typography>
                    <Typography variant="h5" component="div">
                        Blu-ray Player
                    </Typography>
                    <Typography sx={{ color: 'text.secondary', mb: 1.5 }}>
                        Watch Blu-ray discs, with menus.
                    </Typography>
                    <Typography variant="body2">
                        Select an .m2ts file to read.
                    </Typography>
                </CardContent>
                <CardActions>
                    <Button onClick={getFile}>Open file</Button>
                    <Button onClick={getSubsFolder}>Open subtitle folder</Button>
                </CardActions>
            </Card>
        </Backdrop>
        <canvas ref={rendererEl} width={1920} height={1080} />
        <canvas ref={subtitleEl} width={1920} height={1080} />
    </>);
}

export default App;