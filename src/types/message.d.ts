interface TypedWorkerMessage {
    type: string;
}

interface ReadyMessage extends TypedWorkerMessage {
    type: 'ready';
}

interface PingMessage extends TypedWorkerMessage {
    type: 'ping';
}

interface PongMessage extends TypedWorkerMessage {
    type: 'pong';
}

type WorkerMessage = ReadyMessage | PingMessage | PongMessage;