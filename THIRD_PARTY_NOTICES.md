# Third-party notices

Hush Atlas's own source is licensed under the MIT License (see
`LICENSE`). The following components retain their upstream terms.

## YAMNet model code and class map

- **Files:** `backend/vendor/yamnet/yamnet.py`, `features.py`, `params.py`,
  `yamnet_class_map.csv`, and `LICENSE`
- **Source:** TensorFlow Models, AudioSet YAMNet
  <https://github.com/tensorflow/models/tree/master/research/audioset/yamnet>
- **License:** Apache License 2.0. The complete upstream license is retained at
  `backend/vendor/yamnet/LICENSE`.
- **Modifications:** The files are vendored for this application's local
  inference path. No model architecture changes are intended.

## YAMNet model weights

- **File:** `models/yamnet/yamnet.h5` (downloaded at setup time; not included in
  this repository)
- **Source:** Google's official AudioSet storage
  <https://storage.googleapis.com/audioset/yamnet.h5>
- **SHA-256:**
  `13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744`
- **Terms:** The YAMNet code is released under Apache License 2.0. The weights
  are distributed by Google from the official YAMNet/AudioSet location; consult
  the upstream model page and Google's terms for the weights. This project does
  not redistribute them.

## AudioSet ontology

YAMNet's 521 output labels come from the AudioSet ontology. This project uses
the official class map and does not redistribute the AudioSet dataset. AudioSet
has its own dataset terms; see <https://research.google.com/audioset/>.

## Fonts and visual assets

No web fonts, stock photographs, icon packs, or remote images are included. The
interface uses operating-system font stacks, CSS, inline SVG, and the project's
own logo/mark. The screenshots in `docs/screenshots/` were captured from this
application using its synthetic sample archive.

Synthetic demo audio is generated in `backend/app/demo.py` and is covered by the
project's MIT license. No third-party recordings are bundled.

## Main runtime and development dependencies

This is a summary, not a replacement for each package's license file. Transitive
dependencies retain their own licenses.

| Component | Project | License |
| --- | --- | --- |
| TensorFlow | <https://www.tensorflow.org/> | Apache-2.0 |
| tf-keras | <https://github.com/keras-team/tf-keras> | Apache-2.0 |
| NumPy | <https://numpy.org/> | BSD-3-Clause |
| SciPy | <https://scipy.org/> | BSD-3-Clause |
| python-soundfile | <https://github.com/bastibe/python-soundfile> | BSD-3-Clause |
| FastAPI | <https://fastapi.tiangolo.com/> | MIT |
| Uvicorn | <https://www.uvicorn.org/> | BSD-3-Clause |
| Pydantic / pydantic-settings | <https://docs.pydantic.dev/> | MIT |
| python-multipart | <https://github.com/Kludex/python-multipart> | Apache-2.0 |
| HTTPX | <https://www.python-httpx.org/> | BSD-3-Clause |
| pytest | <https://pytest.org/> | MIT |
| React / React DOM | <https://react.dev/> | MIT |
| React Router | <https://reactrouter.com/> | MIT |
| Vite | <https://vite.dev/> | MIT |
| Vitest | <https://vitest.dev/> | MIT |
| TypeScript | <https://www.typescriptlang.org/> | Apache-2.0 |
| lucide-react / Lucide | <https://lucide.dev/> | ISC |
| WebLLM | <https://github.com/mlc-ai/web-llm> | Apache-2.0 |
| Gemma 2 2B (browser model) | <https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC> | Gemma Terms of Use |

## On-device AI model

The On-device AI feature downloads `gemma-2-2b-it-q4f16_1-MLC` (Gemma 2 2B,
4-bit) into the browser's cache only when the user chooses **Download model**. The
model is not bundled with this repository and is not served by Hush Atlas. Its
use is governed by Google's Gemma Terms of Use; the converted weights are
hosted by the MLC AI project on Hugging Face. WebLLM is the runtime that loads
and executes the model on the user's GPU.

The server-side development fallback contacts a loopback Ollama instance and is
not part of the browser feature. Ollama and its models are separately installed
software and are not distributed with this project; their licenses and model
terms apply to those installations.
