export const render = async function(canvas: OffscreenCanvas, port: MessagePort) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    let videoStartTimestamp: number;
    let audioStartTimestamp: number;
    let audioTimestamp: number;
    const pendingFrames: VideoFrame[] = [];
    
    const animate = () => {
        let frame: VideoFrame | undefined;

        if (!videoStartTimestamp)
            return requestAnimationFrame(animate);
        port.postMessage(true);
        if (!audioTimestamp)
            return requestAnimationFrame(animate);
        
        const ts = audioTimestamp - (audioStartTimestamp - videoStartTimestamp) / 90000;
        do {
            frame = pendingFrames[0];
            if (!frame || frame.timestamp - videoStartTimestamp - (ts * 90000) > 3750) 
                break;
            ctx.drawImage(frame, 0, 0);
            frame.close();
            pendingFrames.shift();
        } while (frame.timestamp - videoStartTimestamp < ts * 90000);
        requestAnimationFrame(animate);
    }

    port.onmessage = (e: MessageEvent<VideoFrame | number>) => {
        if (e.data instanceof VideoFrame) {
            if (!videoStartTimestamp) {
                videoStartTimestamp = e.data.timestamp;
                requestAnimationFrame(animate);
            }
            pendingFrames.push(e.data);
        } else {
            if (!audioStartTimestamp) {
                audioStartTimestamp = e.data;
            } else audioTimestamp = e.data;
        }
    };
};