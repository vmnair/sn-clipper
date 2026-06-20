// SnClipper/index.js
// Vinod Nair

import {AppRegistry, Image, ToastAndroid} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {PluginManager, PluginDocAPI, PluginCommAPI} from 'sn-plugin-lib';
import {ClipService} from './src/services/ClipService';

// Initialize Supernote Plugin framework first
PluginManager.init();

// Initialize the aggregated clip state (this will automatically register/
// update the dashboard button name with the loaded count)
ClipService.init();

// Register the standard React Native UI component
AppRegistry.registerComponent(appName, () => App);

// Register Background Selection Button (DOC text-selection toolbar)
PluginManager.registerButton(3, ['DOC'], {
  id: 300,
  name: 'Clip Text',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 0, // Executes background handler, no UI popup
});

// Register Sidebar Button (Plugins menu / Sidebar)
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: 100,
  name: 'Clipper',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1, // Launches full-screen UI (App.tsx)
});


// Register Event Listeners
PluginManager.registerButtonListener({
  async onButtonPress(event) {
    // 1. Detect file type whenever a dashboard or clip button is
    // pressed (runs in active editor context)
    if (event.id === 100 || event.id === 300) {
      try {
        const fileRes = await PluginCommAPI.getCurrentFilePath();
        if (fileRes && fileRes.success && fileRes.result) {
          const path = fileRes.result.toLowerCase();
          // Check if it's a known document format
          const isDoc =
            path.endsWith('.pdf') ||
            path.endsWith('.epub') ||
            path.endsWith('.txt') ||
            path.endsWith('.cbz') ||
            path.endsWith('.fb2');
          // If it is not a document, it is a note
          // (either saved .note or a new unsaved note)
          await ClipService.setActiveFileType(!isDoc);
        } else {
          // If the path is empty/null, it is likely a newly created, unsaved note
          await ClipService.setActiveFileType(true);
        }
      } catch (err) {
        console.error(
          'Failed to capture active file type on button press:',
          err,
        );
        // Default to true (show button) in case of exceptions
        await ClipService.setActiveFileType(true);
      }
    }

    // 2. Handle clipping action
    if (event.id === 300) {
      try {
        // Fetch the highlighted/underlined text
        const response = await PluginDocAPI.getLastSelectedText();
        if (response.success && response.result) {
          const selectedText = response.result;

          // Fetch the active document title
          let articleName = 'Unknown Document';
          try {
            const fileRes = await PluginCommAPI.getCurrentFilePath();
            if (fileRes.success && fileRes.result) {
              const filePath = fileRes.result;
              articleName =
                filePath.substring(filePath.lastIndexOf('/') + 1) ||
                'Unknown Document';
            }
          } catch (fileErr) {
            console.error('Failed to get current file name:', fileErr);
          }

          // Append and copy (triggers button update internally)
          const count = await ClipService.addClip(selectedText, articleName);

          // Transient E-ink feedback
          ToastAndroid.show(
            `Clipped! (${count} clips aggregated)`,
            ToastAndroid.SHORT,
          );
        } else {
          ToastAndroid.show(
            'Clipping failed: No selected text.',
            ToastAndroid.SHORT,
          );
        }
      } catch (err) {
        ToastAndroid.show(`Clipping error: ${err.message}`, ToastAndroid.SHORT);
      }
    }
  },
});
