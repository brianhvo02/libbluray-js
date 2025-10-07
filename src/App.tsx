import { useRef, useState } from 'react';
import './App.scss';
import { Backdrop, Button, Card, CardActions, CardContent, Link, Typography } from '@mui/material';
import { get, set } from 'idb-keyval';
import { transfer } from 'comlink';

const SAMPLE_RATE = 48000;
const DURATION = 1436.105;
const CHANNELS = 2;

const fileSystemAPIFullSupport = !!window.showOpenFilePicker;

const instance = new ComlinkWorker<typeof import('./workers/worker')>(
    new URL('./workers/worker', import.meta.url),
    { type: 'module' }
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
    const canvasEl = useRef<HTMLCanvasElement>(null);
    const audioCtx = useRef<AudioContext | null>(null);
    const pendingFrames = useRef<VideoFrame[]>([]);
    const startTimestamp = useRef(0);

    const animate = () => {
        const { contextTime } = (audioCtx.current?.getOutputTimestamp() ?? {});
        const ctx = canvasEl.current?.getContext('2d');
        if (!ctx) throw new Error('Canvas not ready.');
        let frame: VideoFrame | undefined;
        do {
            frame = pendingFrames.current[0];
            if (!frame || !contextTime 
                || frame.timestamp - startTimestamp.current - (contextTime * 90000) > 3750
            ) break;
            ctx.drawImage(frame, 0, 0);
            frame.close();
            pendingFrames.current.shift();
        } while (frame.timestamp - startTimestamp.current < contextTime * 90000);

        requestAnimationFrame(animate);
    }

    const getFile = () => (fileSystemAPIFullSupport ? getFilePicker : getInputFile)()
        .then(async file => {
            if (!file) throw new Error('File not accessible.');
            // const canvas = canvasEl.current?.transferControlToOffscreen();
            // if (!canvas) throw new Error('Canvas not ready.');
            const channel = new MessageChannel();

            audioCtx.current = new AudioContext();
            const audioBuf = audioCtx.current.createBuffer(CHANNELS, SAMPLE_RATE * DURATION, SAMPLE_RATE);
            const channelBufs = [...Array(CHANNELS).keys()].map(i => audioBuf.getChannelData(i));
            const source = audioCtx.current.createBufferSource();
            source.buffer = audioBuf;
            source.connect(audioCtx.current.destination);

            let start = false;
            channel.port1.onmessage = function(e: MessageEvent<{
                data: Float32Array | VideoFrame;
                timestamp?: number;
                audioOffset?: number;
            }>) {
                const { timestamp, audioOffset, data } = e.data;
                if (data instanceof VideoFrame) {
                    if (!startTimestamp.current)
                        startTimestamp.current = data.timestamp;
                    pendingFrames.current.push(data);
                } else {
                    if (!audioOffset || !timestamp) return;
                    
                    data.forEach((val, i) => {
                        channelBufs[i % CHANNELS][audioOffset + Math.floor(i / 2)] = val;
                    });
                }

                if (!start) {
                    requestAnimationFrame(animate);
                    source.start();
                    start = true;
                }
            }
            
            return instance.openFile(file, transfer(channel.port2, [channel.port2]));
        }).then(setReady);

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
                </CardActions>
            </Card>
        </Backdrop>
        <canvas ref={canvasEl} width={1920} height={1080} />
    </>);
}

export default App;