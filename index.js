// SnClipper/index.js
// Vinod Nair

import {AppRegistry, Image, ToastAndroid} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {PluginManager, PluginDocAPI, PluginCommAPI} from 'sn-plugin-lib';
import {ClipService} from './src/services/ClipService';
import {deriveArticleName} from './src/utils/paths';

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
// PDF/EPUB content. Region capture now has a single entry point: the reader's
// text-selection popup ("Clip" → "Clip Region"), which screenshots the live reader page.

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
          // Collapse wrap newlines/whitespace before counting so a short phrase that merely
          // wrapped to a second line isn't miscounted as a long multi-line block. Decide
          // purely on word count (the old `|| hasNewlines` misfired on wrapped selections).
          const words = selectedText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

          if (words.length > 5) {
            // Case A: > 5 words -> Auto-clip as text (Completely Silent)
            let articleName = 'Unknown Document';
            let documentPath = undefined;
            let documentPage = undefined;
            try {
              const fileRes = await PluginCommAPI.getCurrentFilePath();
              if (fileRes.success && fileRes.result) {
                documentPath = fileRes.result;
                articleName = deriveArticleName(documentPath);
              }
              const pageRes = await PluginCommAPI.getCurrentPageNum();
              if (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) {
                documentPage = pageRes.result;
              }
            } catch (fileErr) {
              console.error('Failed to get current file metadata:', fileErr);
            }
            
            await ClipService.addClip(selectedText, articleName, documentPath, documentPage);
            ToastAndroid.show('Clipped as Text!', ToastAndroid.SHORT);
          } else {
            // Case B: <= 5 words -> Prompt user (launches UI programmatically)
            await Promise.all([
              ClipService.setPromptText(selectedText),
              ClipService.setLaunchMode('prompt'),
            ]);
            await PluginManager.showPluginView();
          }
        }
      } catch (err) {
        console.error('Error in button 300 handler:', err);
      }
    }
  },
});
