# Third-party software

This is an independent MIT-licensed project. It is not an official DeepSeek product.
DSH is installed separately; this repository does not copy or modify the DSH source tree.

The adapter was verified against the published **@deepseek-ai/dsh 0.1.2-rc.1**
package and its matching Session Controller services. Upstream:
https://github.com/deepseek-ai/deepseek-harness (MIT).

Runtime dependencies include React (MIT), Vite (MIT), Fastify (MIT), ws (MIT),
Zod (MIT), qrcode (MIT), @deepseek-ai/schemastery (MIT), libsodium-wrappers
(ISC), and libsodium (ISC). Exact direct and transitive versions are recorded
in pnpm-lock.yaml. Original dependency license files remain in installed packages.
Bundled plugin license texts are collected in THIRD_PARTY_LICENSES.txt.

Cryptographic constructions use libsodium APIs, not locally implemented ciphers:
https://doc.libsodium.org/public-key_cryptography/authenticated_encryption
https://doc.libsodium.org/key_exchange
https://doc.libsodium.org/secret-key_cryptography/secretstream

No third-party hosted relay is a required dependency.
