import { useState } from 'react';
import './App.scss';
import { Backdrop, Button, Card, CardActions, CardContent, Link, Typography } from '@mui/material';
import { get, set } from 'idb-keyval';

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
    const getFile = () => (fileSystemAPIFullSupport ? getFilePicker : getInputFile)()
        .then(async file => {
            if (!file) throw new Error('File not accessible.');
            return instance.openFile(file);
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
    </>);
}

export default App;