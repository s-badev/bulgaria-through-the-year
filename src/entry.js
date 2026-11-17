// Choose the static path before loading any renderer, scene, audio or weather code.
import { showStaticView } from './static-view.js';

if (new URLSearchParams(location.search).get('lite') === '1') {
  showStaticView(true);
} else {
  import('./main.js').catch(error => {
    console.error(error);
    showStaticView(false);
  });
}
