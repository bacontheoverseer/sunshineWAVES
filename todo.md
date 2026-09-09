# Project TODO

- [x] Reproduce dynamic game-source loading failures in the actual sunshine repository. The catalog providers respond successfully, while the local game proxy returns 502 because its required service is unavailable.
- [x] Trace proxy routing for catalog, cover-image, game-document, and game-asset requests. Catalog and cover paths are forwarded to the Mochi service; all fail when that service is not running.
- [ ] Verify game launch input handling and game lifecycle behavior without redesigning the application.
- [ ] Apply minimal corrections only to the code paths responsible for confirmed failures.
- [ ] Add or update automated regression coverage for repaired proxy and game-source behavior.
- [ ] Validate the repaired behavior locally and record any source-specific upstream limitations.
