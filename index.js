// SnClipper/index.js
// Vinod Nair

import {AppRegistry, Image, ToastAndroid, NativeModules} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {PluginManager, PluginDocAPI, PluginCommAPI, PluginFileAPI} from 'sn-plugin-lib';
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

// Register Lasso Image Clip Button (DOC lasso toolbar only)
PluginManager.registerButton(2, ['DOC'], {
  id: 200,
  name: 'Clip selected region',
  icon: Image.resolveAssetSource(require('./assets/icon/icon.png')).uri,
  showType: 0, // Executes background handler, no UI popup
  editDataTypes: [0, 1, 2, 3, 4, 5],
});

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
    } else if (event.id === 200) {
      try {
        const fileRes = await PluginCommAPI.getCurrentFilePath();
        if (!fileRes.success || !fileRes.result) {
          ToastAndroid.show('Clipping failed: No active file.', ToastAndroid.SHORT);
          return;
        }
        const filePath = fileRes.result;
        const pageRes = await PluginCommAPI.getCurrentPageNum();
        const page = (pageRes.success && pageRes.result !== undefined && pageRes.result !== null) ? pageRes.result : 0;
        
        const rectRes = await PluginCommAPI.getLassoRect();
        if (!rectRes.success || !rectRes.result) {
          ToastAndroid.show('Clipping failed: No lasso selection.', ToastAndroid.SHORT);
          return;
        }
        const rect = rectRes.result;
        
        const left = Math.floor(rect.left);
        const top = Math.floor(rect.top);
        const width = Math.ceil(rect.right - rect.left);
        const height = Math.ceil(rect.bottom - rect.top);
        
        if (width <= 0 || height <= 0) {
          ToastAndroid.show('Clipping failed: Selection area is empty.', ToastAndroid.SHORT);
          return;
        }

        const pluginDir = await PluginManager.getPluginDirPath();
        if (!pluginDir) {
          ToastAndroid.show('Clipping failed: Cannot access storage.', ToastAndroid.SHORT);
          return;
        }

        const tempFullPagePath = `${pluginDir}/temp_page_${Date.now()}.png`;
        const destPath = `${pluginDir}/clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.png`;

        const isNote = filePath.endsWith('.note') || filePath.endsWith('.not') || !filePath.includes('.');
        let genSuccess = false;
        
        if (isNote) {
          const genRes = await PluginFileAPI.generateNotePng({
            notePath: filePath,
            page: page,
            times: 1,
            pngPath: tempFullPagePath,
            type: 1
          });
          genSuccess = genRes && genRes.success;
        } else {
          let pageSize = { width: 1404, height: 1872 };
          try {
            const sizeRes = await PluginFileAPI.getPageSize(filePath, page);
            if (sizeRes.success && sizeRes.result) {
              pageSize = sizeRes.result;
            }
          } catch (sizeErr) {
            console.error('Failed to get page size:', sizeErr);
          }
          const genRes = await PluginDocAPI.generateDocImage(
            filePath,
            page,
            tempFullPagePath,
            pageSize
          );
          genSuccess = genRes && genRes.success;
        }

        if (!genSuccess) {
          ToastAndroid.show('Clipping failed: Failed to generate page screenshot.', ToastAndroid.SHORT);
          return;
        }

        const { ImageCropModule } = NativeModules;
        if (!ImageCropModule) {
          ToastAndroid.show('Clipping failed: Native Crop module not registered.', ToastAndroid.SHORT);
          return;
        }

        const cropSuccess = await ImageCropModule.cropImage(
          tempFullPagePath,
          left,
          top,
          width,
          height,
          destPath
        );

        const { FileUtils } = require('sn-plugin-lib');
        try {
          await FileUtils.deleteFile(tempFullPagePath);
        } catch (delErr) {
          console.error('Failed to delete temp screenshot:', delErr);
        }

        if (cropSuccess) {
          const articleName = filePath.substring(filePath.lastIndexOf('/') + 1) || 'Unknown Document';
          const count = await ClipService.addImageClip(destPath, articleName);
          ToastAndroid.show(
            `Image clipped! (${count} clips aggregated)`,
            ToastAndroid.SHORT
          );
        } else {
          ToastAndroid.show('Clipping failed: Crop failed.', ToastAndroid.SHORT);
        }
      } catch (err) {
        ToastAndroid.show(`Clipping error: ${err.message}`, ToastAndroid.SHORT);
      }
    }
  },
});
