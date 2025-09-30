import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './reset.css';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import App from './App.tsx';

const darkTheme = createTheme({
    palette: {
        mode: 'dark',
    },
});

const rootEl = document.getElementById('root');
if (rootEl) {
    createRoot(rootEl).render(
        <StrictMode>
            <ThemeProvider theme={darkTheme}>
                <CssBaseline />
                <App />
            </ThemeProvider>
        </StrictMode>,
    );
}

