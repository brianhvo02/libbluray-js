// emcc -lembind -o encode.js -I build_libs/include -L build_libs/lib encode.cpp -lFLAC++ -lFLAC -logg

#include <FLAC++/encoder.h>
#include <emscripten/bind.h>
#include <emscripten/wasmfs.h>

using namespace emscripten;

#define READSIZE 1024

class Encoder: public FLAC::Encoder::File {
public:
	Encoder(): FLAC::Encoder::File() { }
protected:
	virtual void progress_callback(FLAC__uint64 bytes_written, FLAC__uint64 samples_written, uint32_t frames_written, uint32_t total_frames_estimate);
};

void Encoder::progress_callback(FLAC__uint64 bytes_written, FLAC__uint64 samples_written, uint32_t frames_written, uint32_t total_frames_estimate) {
	printf("wrote %llu bytes, %llu samples, %u/%u frames\n", bytes_written, samples_written, frames_written, total_frames_estimate);
}

int encode(std::string input_file, std::string output_file, uint32_t sample_rate, uint32_t channels, uint32_t bps) {
    bool ok = true;
	Encoder encoder;
	FLAC__StreamEncoderInitStatus init_status;
	FILE *fin;
    FLAC__byte buffer[READSIZE * bps * channels];
    FLAC__int32 pcm[READSIZE * channels];

	backend_t opfs = wasmfs_create_opfs_backend();
	int err = wasmfs_create_directory("/opfs", 0777, opfs);
  	assert(err == 0);

	std::string input_filepath = "/opfs/" + input_file;
    if ((fin = fopen(input_filepath.c_str(), "rb")) == NULL) {
		fprintf(stderr, "ERROR: opening %s for output\n", input_file.c_str());
		return 1;
	}

    fseek(fin, 0, SEEK_END);
	uint32_t total_samples = ftell(fin) / (bps / 8) / channels;
    fseek(fin, 0, SEEK_SET);

    if(!encoder) {
		fprintf(stderr, "ERROR: allocating encoder\n");
		fclose(fin);
		return 1;
	}

	ok &= encoder.set_verify(true);
	ok &= encoder.set_compression_level(8);
	ok &= encoder.set_channels(channels);
	ok &= encoder.set_bits_per_sample(bps);
	ok &= encoder.set_sample_rate(sample_rate);
	ok &= encoder.set_total_samples_estimate(total_samples);

    if (ok) {
		std::string output_filepath = "/opfs/" + output_file;
		init_status = encoder.init(output_filepath);
		if (init_status != FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
			fprintf(stderr, "ERROR: initializing encoder: %s\n", FLAC__StreamEncoderInitStatusString[init_status]);
			ok = false;
		}
	}

	fread(buffer, channels * (bps / 8), READSIZE, fin);
    if (ok) {
		size_t left = (size_t)total_samples;
		while (ok && left) {
			size_t need = (left > READSIZE ? (size_t)READSIZE : (size_t)left);
			if (fread(buffer, channels * (bps / 8), need, fin) != need) {
				fprintf(stderr, "ERROR: reading from WAVE file\n");
				ok = false;
			} else {
				size_t i;
				for (i = 0; i < need*channels; i++)
					pcm[i] = (
                        (buffer[3 * i] << 24) 
                        | (buffer[3 * i + 1] << 16) 
                        | (buffer[3 * i + 2] << 8)
                    ) >> 8;
				ok = encoder.process_interleaved(pcm, need);
                
			}
			left -= need;
		}
	}

    ok &= encoder.finish();
	fclose(fin);

	return !ok;
}

// int main(int argc, char const *argv[]) {
//     return encode("00008.raw", "00008.flac", 48000, 2, 24);
// }

EMSCRIPTEN_BINDINGS(flac_module) {
    function("encode", &encode, emscripten::async());
}