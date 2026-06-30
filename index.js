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
  name: 'Clip',
  icon: Image.resolveAssetSource(require('./assets/icon/icon.png')).uri,
  showType: 0, // Executes background handler, no UI popup
});

// NOTE: A lasso image-clip button (type 2) was removed — the document lasso toolbar is
// gated on `editDataTypes` (note-element types), so it never appears over rendered
// PDF/EPUB content. Image capture is now triggered from the dashboard header button
// (crop current page) and the text-selection prompt's "Clip Region" option instead.

// Register Sidebar Button (Plugins menu / Sidebar)
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: 100,
  name: 'Clipper',
  icon: Image.resolveAssetSource(require('./assets/icon/icon.png')).uri,
  showType: 1, // Launches full-screen UI (App.tsx)
});


// Register Event Listeners
PluginManager.registerButtonListener({
  async onButtonPress(event) {
    if (event.id === 300) {
      try {
        const response = await PluginDocAPI.getLastSelectedText();
        if (response.success && response.result) {
          const selectedText = response.result;
          const words = selectedText.trim().split(/\s+/).filter(Boolean);
          const hasNewlines = /[\r\n]/.test(selectedText);
          
          if (words.length > 5 || hasNewlines) {
            // Case A: > 5 words or contains newlines -> Auto-clip as text (Completely Silent)
            let articleName = 'Unknown Document';
            try {
              const fileRes = await PluginCommAPI.getCurrentFilePath();
              if (fileRes.success && fileRes.result) {
                const filePath = fileRes.result;
                articleName = filePath.substring(filePath.lastIndexOf('/') + 1) || 'Unknown Document';
              }
            } catch (fileErr) {
              console.error('Failed to get current file name:', fileErr);
            }
            
            await ClipService.addClip(selectedText, articleName);
            ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
          } else {
            // Case B: <= 5 words and no newlines -> Prompt user (launches UI programmatically)
            await ClipService.setPromptText(selectedText);
            await ClipService.setLaunchMode('prompt');
            await PluginManager.showPluginView();
          }
        }
      } catch (err) {
        console.error('Error in button 300 handler:', err);
      }
    }
  },
});
