const MAX_BUF_SIZE = 2**29 - 128;
const PACKET_SIZE = 192;

const _parseTimestamp = function(p: Uint8Array, idx: number) {
    let ts = 0n;
    ts  = (BigInt(p[idx + 0]) & 0x0En) << 29n;
    ts |=  BigInt(p[idx + 1])          << 22n;
    ts |= (BigInt(p[idx + 2]) & 0xFEn) << 14n;
    ts |=  BigInt(p[idx + 3])          <<  7n;
    ts |= (BigInt(p[idx + 4]) & 0xFEn) >>  1n;
    return Number(ts);
}

const _parsePes = function(buf: Uint8Array, idx: number, len: number) {
    let result = 0;

    if (len < 6) {
        console.log('invalid BDAV TS (PES header not in single TS packet)');
        return { result: -1 };
    }
    if (buf[idx] || buf[idx + 1] || buf[idx + 2] != 1) {
        // console.log('invalid PES header (00 00 01)');
        return { result: -1 };
    }

    // Parse PES header
    const pesPid    = buf[idx + 3];
    const pesLength = buf[idx + 4] << 8 | buf[idx + 5];
    let hdrLen = 6;
    let pts = 0;

    if (pesPid != 0xBF) {
        if (len < 9) {
            console.log('invalid BDAV TS (PES header not in single TS packet)');
            return { result: -1 };
        }

        const ptsExists = buf[idx + 7] & 0x80;
        // const dtsExists = buf[idx + 7] & 0x40;
        hdrLen += buf[idx + 8] + 3;

        if (len < hdrLen) {
            console.log('invalid BDAV TS (PES header not in single TS packet)');
            return { result: -1 };
        }

        if (ptsExists)
            pts = _parseTimestamp(buf, idx + 9);
        // const dts = dtsExists && _parseTimestamp(buf, idx + 14);
    }

    result = pesLength && (pesLength + 6 - hdrLen);

    return { result, pts, newBuf: buf.slice(idx + hdrLen) };
}

const checkPsData = function(data: Uint8Array) {
    let idr = false;
    let sps = false;
    let pps = false;
    
    for (let i = 0; i < data.length - 4; i++) {
        if (idr && sps && pps) return true;

        if (data[i] !== 0 || data[i + 1] !== 0)
            continue;

        if (data[i + 2] === 0 && data[i + 3] === 1) {
            const nalType = data[i + 4] & 0x1F;
            if (nalType === 7)
                sps = true;
            if (nalType === 8)
                pps = true;
        }
        
        if (data[i + 2] === 1) {
            const nalType = data[i + 3] & 0x1F;
            if (nalType === 5)
                idr = true;
        }
    }

    return idr && sps && pps;
}

// const bitsPerSamples = [0, 16, 20, 24];
// const channelLayouts = [
//     '',         'mono',     '', 
//     'stereo',   'surround', '2.1', 
//     '4.0',      '2.2',      '5.0', 
//     '5.1',      '7.0',      '7.1',
// ];
const VIDEO_PID = 0x1011;
const getBufLen = (bufs: Uint8Array[]) => bufs.reduce((sum, buf) => sum + buf.length, 0);
type StreamMap = Record<number, { bufs: Uint8Array[]; pesLength: number; timestamp: number; }>;

export const openFile = async function(file: File, port: MessagePort) {
    let audioOffset = 0;
    let firstVideoTimestamp: number;

    const config: VideoDecoderConfig = {
        codec: 'avc1.640829',
        codedWidth: 1080,
        codedHeight: 1920,
    };

    const { supported } = await VideoDecoder.isConfigSupported(config);
    if (!supported) {
        console.error('Codec not supported.');
        return false;
    }
    const decoder = new VideoDecoder({
        output: frame => port.postMessage({ data: frame }, [frame]),
        error: (e) => {
            console.log(e.message);
        },
    });
    decoder.configure(config);

    const streamMap: StreamMap = {};
    const newFrame = async (pid: number) => {
        const bufLen = getBufLen(streamMap[pid].bufs);
        // console.log(`PES complete (${bufLen} bytes)`);

        const data = new Uint8Array(bufLen);
        streamMap[pid].bufs.reduce((idx, buf) => {
            data.set(buf, idx);
            return idx + buf.length;
        }, 0);
        
        if (pid === VIDEO_PID) {
            const psDetected = checkPsData(data);
            if (!firstVideoTimestamp && !psDetected) {
                streamMap[pid].bufs.length = 0;
                return;
            } else if (!firstVideoTimestamp && psDetected) {
                firstVideoTimestamp = streamMap[pid].timestamp;
            } else if (firstVideoTimestamp && psDetected) {
                await decoder.flush();
            }

            const chunk = new EncodedVideoChunk({
                type: 'key', timestamp: streamMap[pid].timestamp, data
            });
            decoder.decode(chunk);
        }
        if (pid === 0x1100 && streamMap[pid].timestamp >= firstVideoTimestamp) {
            // const channelLayout = channelLayouts[data[2] >> 4];
            // const bitsPerCodedSample = bitsPerSamples[data[3] >> 6];
            // const sampleFmt = bitsPerCodedSample === 16 ? 's16' : 's32';
            // const sampleRateVal = data[2] & 0x0F;
            // const sampleRate = sampleRateVal === 1 ? 48000
            //     : sampleRateVal === 4 ? 96000
            //     : sampleRateVal === 5 ? 192000
            //     : 0;
            // if (audioData.length > 0)
            // throw new Error()
            const arr = data.slice(4);
            const fArr = new Float32Array(arr.length / 3);
            for (let i = 0; i < arr.length / 3; i++) {
                const val = (arr[i * 3] << 16) | (arr[i * 3 + 1] << 8) | (arr[i * 3 + 2]);
                fArr[i] = ((val & 2**23) ? val - 2**24 : val) / 2**23;
            }

            port.postMessage({ 
                data: fArr,
                timestamp: streamMap[pid].timestamp, 
                audioOffset, 
            }, [fArr.buffer]);

            audioOffset += arr.length / 6;
        }
        
        streamMap[pid].bufs.length = 0;
    }

    const numChunks = Math.ceil(file.size / MAX_BUF_SIZE);
    for (let i = 0; i < numChunks; i++) {
        if (i < 0) continue;
        const chunk = await file.slice(
            i * MAX_BUF_SIZE, i < numChunks - 1 ? (i + 1) * MAX_BUF_SIZE : undefined
        ).arrayBuffer();
        for (let j = 0; j < chunk.byteLength / PACKET_SIZE; j++) {
            if (i === 0 && j < 0) continue;
            const packet = chunk.slice(j * PACKET_SIZE, (j + 1) * PACKET_SIZE);
            const p = new Uint8Array(packet);

            const tpError       = p[4+1] & 0x80;
            const pusi          = p[4+1] & 0x40;
            const pid           = ((p[4+1] & 0x1f) << 8) | p[4+2];
            const payloadExists = p[4+3] & 0x10;
            const payloadOffset = (p[4+3] & 0x20) ? p[4+4] + 5 : 4;

            if (p[4] !== 0x47) {
                console.log('missing sync byte. scrambled data ?');
                return false;
            }
            if (tpError) {
                console.log('skipping packet (transport error)');
                continue;
            }
            if (!payloadExists) {
                // console.log('skipping packet (no payload)');
                continue;
            }
            if (payloadOffset >= 188) {
                console.log('skipping packet (invalid payload start address)');
                continue;
            }

            if (!streamMap[pid])
                streamMap[pid] = { bufs: [], pesLength: 0, timestamp: 0 };

            if (pusi) {
                if (streamMap[pid].bufs.length && streamMap[pid].pesLength) {
                    const bufLen = getBufLen(streamMap[pid].bufs);
                    console.log(`PES length mismatch: have ${bufLen}, expected ${streamMap[pid].pesLength}`);
                }
                if (streamMap[pid].bufs.length && !streamMap[pid].pesLength)
                    await newFrame(pid);

                const { result: r, pts, newBuf } = _parsePes(p, 4 + payloadOffset, 188 - payloadOffset);

                if (r < 0 || !pts) continue;
                if (newBuf) streamMap[pid].bufs.push(newBuf);
                streamMap[pid].timestamp = pts;
                streamMap[pid].pesLength = r;
            } else {
                if (!streamMap[pid].bufs.length) {
                    console.log('skipping packet (no pusi seen)');
                    continue;
                }
                
                streamMap[pid].bufs.push(p.slice(4 + payloadOffset));
            }

            if (streamMap[pid].pesLength && getBufLen(streamMap[pid].bufs) === streamMap[pid].pesLength)
                await newFrame(pid);
        }

        const progress = (i + 1) * MAX_BUF_SIZE / file.size;
        console.log(progress >= 1 ? '100%' : (progress * 100).toFixed(2) + '%');
    }

    return true;
};