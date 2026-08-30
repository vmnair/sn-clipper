// SnClipper/index.js
// Vinod Nair

import {AppRegistry, Image, ToastAndroid, NativeModules} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {PluginManager, PluginDocAPI, PluginCommAPI} from 'sn-plugin-lib';
import {ClipService} from './src/services/ClipService';
import {deriveArticleName} from './src/utils/paths';
import {PermissionService, FILE_READ} from './src/services/PermissionService';

const { ImageCropModule } = NativeModules;

async function captureReaderScreenToPending() {
  if (ImageCropModule && typeof ImageCropModule.captureScreen === 'function') {
    try {
      const dir = await PluginManager.getPluginDirPath();
      if (dir) {
        ClipService.clearPendingCropShot();
        const shotPath = `${dir}/reader_shot_${Date.now()}.png`;
        const cap = await ImageCropModule.captureScreen(shotPath);
        if (cap && cap.path && cap.width && cap.height) {
          ClipService.setPendingCropShot({
            path: cap.path,
            width: cap.width,
            height: cap.height,
            ts: Date.now(),
          });
        }
      }
    } catch (e) {
      console.warn('captureReaderScreenToPending error:', e);
    }
  }
}

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

// Register Dedicated Region-Capture Button (DOC toolbar)
PluginManager.registerButton(1, ['DOC'], {
  id: 101,
  name: 'Clip Region',
  icon: Image.resolveAssetSource(require('./assets/icon/clip_region.png')).uri,
  showType: 0, // Executes background handler, captures screenshot before showing UI
});


// Register Event Listeners
PluginManager.registerButtonListener({
  async onButtonPress(event) {
    if (event.id === 300) {
      try {
        // Reading the reader's selection is a FILE:READ operation under the host permission
        // system. Gate it here, before the first API call, so a missing grant produces
        // guidance instead of a silent no-op (getLastSelectedText would fail with 1503).
        const outcome = await PermissionService.ensure(
          FILE_READ,
          'Clipper needs read access to capture the text you selected.',
        );

        if (outcome === 'blocked') {
          ToastAndroid.show(
            'Clipper: allow file access in Settings → Apps → Plugins → Clipper → Permissions',
            ToastAndroid.LONG,
          );
          return;
        }

        if (outcome === 'unavailable') {
          // The host could not show its dialog from this background (showType:0) press.
          // Fall back to the foreground: open Clipper in 'permission' launch mode, which
          // re-requests with a UI attached and completes the clip from there.
          await ClipService.setLaunchMode('permission');
          await PluginManager.showPluginView();
          return;
        }

        if (outcome === 'denied') {
          // Dialog was shown and dismissed — the next press prompts again.
          ToastAndroid.show('Clipper needs permission to clip', ToastAndroid.SHORT);
          return;
        }

        const response = await PluginDocAPI.getLastSelectedText();
        // Defense in depth: an "allow this time only" grant dies with the plugin session, so
        // a read can still come back 1503 after the gate above said granted.
        if (response && response.success === false && PermissionService.isPermissionError(response)) {
          ToastAndroid.show(
            PermissionService.messageForError(response) || 'Clipper needs permission to clip',
            ToastAndroid.LONG,
          );
          return;
        }
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
            // Case B: <= 5 words -> Prompt user (take screenshot first while reader is still visible)
            await captureReaderScreenToPending();
            await Promise.all([
              ClipService.setPromptText(selectedText),
              ClipService.setLaunchMode('prompt'),
            ]);
            await PluginManager.showPluginView();
          }
        }
      } catch (err) {
        console.error('Error in button 300 handler:', err);
        const permMsg = PermissionService.messageForError(err);
        if (permMsg) {
          ToastAndroid.show(permMsg, ToastAndroid.LONG);
        }
      }
    }

    if (event.id === 101) {
      try {
        // Set launchMode to 'crop' immediately so concurrent UI initialization knows the intent
        await ClipService.setLaunchMode('crop');

        const outcome = await PermissionService.ensure(
          FILE_READ,
          'Clipper needs read access to capture the page region.',
        );

        if (outcome === 'blocked') {
          await ClipService.setLaunchMode('normal');
          ToastAndroid.show(
            'Clipper: allow file access in Settings → Apps → Plugins → Clipper → Permissions',
            ToastAndroid.LONG,
          );
          return;
        }

        if (outcome === 'unavailable') {
          await captureReaderScreenToPending();
          await PluginManager.showPluginView();
          return;
        }

        if (outcome === 'denied') {
          await ClipService.setLaunchMode('normal');
          ToastAndroid.show('Clipper needs permission to capture region', ToastAndroid.SHORT);
          return;
        }

        await captureReaderScreenToPending();
        await PluginManager.showPluginView();
      } catch (err) {
        console.error('Error in button 101 handler:', err);
        await ClipService.setLaunchMode('normal');
        const permMsg = PermissionService.messageForError(err);
        if (permMsg) {
          ToastAndroid.show(permMsg, ToastAndroid.LONG);
        }
      }
    }
  },
});
