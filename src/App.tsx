import { useState } from 'react';
import './App.scss';
import { Alert, Button } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';

const instance = new ComlinkWorker<typeof import('./workers/worker')>(
    new URL('./workers/worker', import.meta.url),
    { type: 'module' }
);

const App = function() {
    const [pong, setPong] = useState('');

    const onPing = () => {
        instance.ping().then(setPong);
    }

    return (<>
        <Button onClick={onPing}>Ping</Button>
        { !!pong.length &&
        <Alert icon={<CheckIcon fontSize='inherit' />} severity='success'>
            {pong}
        </Alert> }
    </>);
}

export default App;