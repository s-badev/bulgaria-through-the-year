// Choose the static path before loading any renderer, scene, audio or weather code.
import { showStaticView } from './static-view.js';
import { reportSceneError } from './diagnostics.js';

if (new URLSearchParams(location.search).get('lite') === '1') {
  showStaticView(true);
} else {
  import('./main.js').catch(error => {
    const reason = reportSceneError(error, 'entry', false, 'module-load');
    showStaticView(false, undefined, undefined, reason);
  });
}
