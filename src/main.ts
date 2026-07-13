// Entry point shared by index.html (gallery) and viewer.html (single
// full-bleed embed). Registers the <euclid-player> custom element; each
// HTML page is responsible for its own markup/instances of the element.

import { registerEuclidPlayer } from './player/euclid-player';

registerEuclidPlayer();
