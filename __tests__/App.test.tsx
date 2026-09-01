import React from 'react';
import renderer, { act } from 'react-test-renderer';
import App from '../src/App';
import { ClipService } from '../src/services/ClipService';
import { StorageService, ClipItem } from '../src/services/StorageService';
import { Clipboard, ToastAndroid, Text, Pressable, TextInput } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { ConfirmationDialog } from '../src/components/ConfirmationDialog';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    getItem: jest.fn(async (key: string) => {
      return store[key] || null;
    }),
    clear: jest.fn(async () => {
      store = {};
    }),
  };
});

jest.mock('react-native', () => {
  return {
    SafeAreaView: 'SafeAreaView',
    ScrollView: 'ScrollView',
    FlatList: jest.fn(({ data, renderItem, ListEmptyComponent }: any) => {
      const React = require('react');
      if (!data || data.length === 0) {
        return ListEmptyComponent ? (React.isValidElement(ListEmptyComponent) ? ListEmptyComponent : React.createElement(ListEmptyComponent)) : null;
      }
      return React.createElement(
        'FlatList',
        null,
        data.map((item: any, index: number) => {
          const rendered = renderItem({ item, index });
          if (React.isValidElement(rendered)) {
            return React.cloneElement(rendered, { key: item.id || index } as any);
          }
          return rendered;
        })
      );
    }),
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    TextInput: 'TextInput',
    StyleSheet: {
      create: (styles: any) => styles,
    },
    Clipboard: {
      setString: jest.fn(),
      getString: jest.fn(),
    },
    ToastAndroid: {
      show: jest.fn(),
      SHORT: 0,
      LONG: 1,
    },
    Image: (() => {
      const fn = (props: any) => null;
      fn.resolveAssetSource = jest.fn().mockReturnValue({ uri: 'mock-uri' });
      fn.getSize = jest.fn((uri, success) => {
        if (success) {
          success(300, 300);
        }
      });
      return fn;
    })(),
    NativeModules: {
      ImageCropModule: {
        cropImage: jest.fn().mockResolvedValue(true),
        openFileDirectly: jest.fn().mockResolvedValue(true),
      },
    },
    AppState: {
      addEventListener: jest.fn((_evt: any, cb: any) => { (globalThis as any).__appStateCb = cb; return { remove: jest.fn() }; }),
    },
    BackHandler: {
      exitApp: jest.fn(),
    },
  };
});

let mockCurrentPage = 0;

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    init: jest.fn(),
    registerButton: jest.fn(),
    registerButtonListener: jest.fn(),
    closePluginView: jest.fn(),
    getPluginDirPath: jest.fn().mockResolvedValue('/sdcard/Supernote/Plugins/SnClipper'),
  },
  PluginCommAPI: {
    getCurrentFilePath: jest.fn().mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' }),
    getCurrentPageNum: jest.fn().mockImplementation(async () => ({ success: true, result: mockCurrentPage })),
    jumpToPage: jest.fn().mockImplementation(async (pg: number) => {
      mockCurrentPage = pg;
      return { success: true, result: true };
    }),
    reloadFile: jest.fn().mockResolvedValue({ success: true, result: true }),
  },
  PluginFileAPI: {
    getPageSize: jest.fn().mockResolvedValue({ success: true, result: { width: 1404, height: 1872 } }),
    getLastElement: jest.fn().mockResolvedValue({ success: true, result: { uuid: 'mock-uuid', type: 200, picture: { picturePath: '/storage/emulated/0/.data/plugin/mock.png', rect: { left: 0, top: 0, right: 300, bottom: 300 } } } }),
    getElements: jest.fn().mockResolvedValue({ success: true, result: [] }),
    modifyElements: jest.fn().mockResolvedValue({ success: true }),
    insertElements: jest.fn().mockResolvedValue({ success: true }),
    generateNotePng: jest.fn().mockResolvedValue({ success: true }),
    openFile: jest.fn().mockResolvedValue({ success: true }),
    getNoteTotalPageNum: jest.fn().mockResolvedValue({ success: true, result: 1 }),
    insertNotePage: jest.fn().mockResolvedValue({ success: true, result: true }),
    getNotePageTemplate: jest.fn().mockResolvedValue({ success: true, result: { name: 'style_5mm_dots' } }),
    getPathEncryptionStatus: jest.fn().mockResolvedValue({ success: true, result: 0 }),
  },
  PluginDocAPI: {
    generateCurrentDocImage: jest.fn().mockResolvedValue({ success: true }),
    getLastSelectedText: jest.fn().mockResolvedValue({ success: true, result: '' }),
  },
  PluginNoteAPI: {
    saveCurrentNote: jest.fn().mockResolvedValue({ success: true }),
    insertText: jest.fn().mockResolvedValue({ success: true }),
    insertImage: jest.fn().mockResolvedValue({ success: true, result: { uuid: 'mock-uuid', picture: { rect: { left: 0, top: 0, right: 300, bottom: 300 } } } }),
    insertTextLink: jest.fn().mockResolvedValue({ success: true }),
    generateLayerPreviewImage: jest.fn().mockResolvedValue({ success: true }),
  },
  FileUtils: {
    deleteFile: jest.fn().mockResolvedValue(true),
    exists: jest.fn().mockResolvedValue(true),
    listFiles: jest.fn().mockResolvedValue([]),
  },
  NativePluginManager: {
    invalidatePluginView: jest.fn(),
  },
}));

describe('App Component', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    const { PluginFileAPI, PluginCommAPI, PluginDocAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements.mockReset();
    PluginFileAPI.getElements.mockResolvedValue({ success: true, result: [] });
    PluginFileAPI.generateNotePng.mockResolvedValue({ success: true });
    PluginDocAPI.generateCurrentDocImage.mockResolvedValue({ success: true });
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockImplementation(async () => ({ success: true, result: mockCurrentPage }));
    PluginCommAPI.jumpToPage.mockImplementation(async (pg: number) => {
      mockCurrentPage = pg;
      return { success: true, result: true };
    });
    PluginCommAPI.reloadFile.mockResolvedValue({ success: true, result: true });
    PluginFileAPI.getNoteTotalPageNum.mockResolvedValue({ success: true, result: 1 });
    // Reset persisted settings (combine/font/auto-remove) so they don't leak between tests.
    await require('@react-native-async-storage/async-storage').clear();
    mockCurrentPage = 0;
    (ClipService as any).listeners = [];
    await ClipService.clearClips();
    (ClipService as any).initialized = false;
    (ClipService as any).initPromise = null;
  });

  const renderApp = async () => {
    let root: any;
    await act(async () => {
      root = renderer.create(<App />);
    });
    // Wait for useEffect init and state update
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return root;
  };

  it('renders correctly with empty clips', async () => {
    const root = await renderApp();
    const json = root.toJSON();
    expect(json).toBeTruthy();

    const textElements = root.root.findAllByType(Text);
    const emptyText = textElements.find((el: any) =>
      el.props.children &&
      typeof el.props.children === 'string' &&
      el.props.children.includes('No clippings aggregated yet')
    );
    expect(emptyText).toBeTruthy();
  });

  it('renders clips correctly', async () => {
    await ClipService.addClip('Test snippet 1', 'Article A');
    await ClipService.addClip('Test snippet 2', 'Article B');

    const root = await renderApp();

    const textElements = root.root.findAllByType(Text);
    const item1 = textElements.find((el: any) => el.props.children === 'Test snippet 1');
    const item2 = textElements.find((el: any) => el.props.children === 'Test snippet 2');
    expect(item1).toBeTruthy();
    expect(item2).toBeTruthy();
  });

  it('copies all text when clicking Copy Full Text', async () => {
    await ClipService.addClip('Snippet A', 'Doc A');

    const root = await renderApp();

    const copyBtn = root.root.findByProps({ label: 'Copy Visible' });
    await act(async () => {
      copyBtn.props.onPress();
    });

    expect(Clipboard.setString).toHaveBeenCalledWith('Snippet A');
    expect(ToastAndroid.show).toHaveBeenCalledWith('Visible clips copied!', ToastAndroid.SHORT);
  });

  it('handles clearing all clips', async () => {
    await ClipService.addClip('Snippet A', 'Doc A');

    const root = await renderApp();

    const clearBtn = root.root.findByProps({ label: 'Clear All' });
    await act(async () => {
      await clearBtn.props.onPress();
    });

    expect(ClipService.getClipsSync()).toEqual([]);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clipboard cleared!', ToastAndroid.SHORT);
  });

  it('closes plugin view on Header Close (X) button click', async () => {
    const root = await renderApp();

    const headerCloseBtn = root.root.findByProps({ testID: 'header-close-btn' });
    await act(async () => {
      headerCloseBtn.props.onPress();
    });

    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });



  it('handles multi-selection long-press and selection toggle', async () => {
    await ClipService.addClip('Snippet 1', 'Doc A');
    await ClipService.addClip('Snippet 2', 'Doc B');

    const root = await renderApp();

    // 1. Long press first snippet to enter selection mode
    const pressables = root.root.findAllByType(Pressable);
    const card1 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 1')
    );
    expect(card1).toBeTruthy();

    await act(async () => {
      card1.props.onLongPress();
    });

    // Subtitle should reflect selection mode
    const textElements = root.root.findAllByType(Text);
    const subtitle = textElements.find((el: any) =>
      el.props.children &&
      typeof el.props.children === 'string' &&
      el.props.children.includes('selected')
    );
    expect(subtitle.props.children).toContain('1 of 2 clip(s) selected');

    // 2. Click second card in selection mode to select it
    const card2 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 2')
    );
    expect(card2).toBeTruthy();

    await act(async () => {
      card2.props.onPress();
    });

    expect(subtitle.props.children).toContain('2 of 2 clip(s) selected');

    // 3. Click first card again to deselect it
    await act(async () => {
      card1.props.onPress();
    });

    expect(subtitle.props.children).toContain('1 of 2 clip(s) selected');
  });

  it('copies selected clips', async () => {
    await ClipService.addClip('Snippet 1', 'Doc A');
    await ClipService.addClip('Snippet 2', 'Doc B');

    const root = await renderApp();

    // Select first snippet
    const pressables = root.root.findAllByType(Pressable);
    const card1 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 1')
    );
    await act(async () => {
      card1.props.onLongPress();
    });

    // Copy selected
    const copySelectedBtn = root.root.findByProps({ label: 'Copy Selected' });
    await act(async () => {
      await copySelectedBtn.props.onPress();
    });

    expect(Clipboard.setString).toHaveBeenCalledWith('Snippet 1');
    expect(ToastAndroid.show).toHaveBeenCalledWith('1 clip(s) copied!', ToastAndroid.SHORT);
  });

  it('deletes selected clips', async () => {
    await ClipService.addClip('Snippet 1', 'Doc A');
    await ClipService.addClip('Snippet 2', 'Doc B');

    const root = await renderApp();

    // Select first snippet
    const pressables = root.root.findAllByType(Pressable);
    const card1 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 1')
    );
    await act(async () => {
      card1.props.onLongPress();
    });

    // Delete selected
    const deleteSelectedBtn = root.root.findByProps({ label: 'Delete Selected' });
    await act(async () => {
      await deleteSelectedBtn.props.onPress();
    });

    const remaining = ClipService.getClipsSync();
    expect(remaining.length).toBe(1);
    expect(remaining[0].text).toBe('Snippet 2');
    expect(ToastAndroid.show).toHaveBeenCalledWith('1 clip(s) deleted!', ToastAndroid.SHORT);
  });

  it('handles merging selected clips, showing disabled state when < 2 selected and calling merge on press when >= 2 selected', async () => {
    await ClipService.addClip('Snippet 1', 'Doc A');
    await ClipService.addClip('Snippet 2', 'Doc B');

    const root = await renderApp();

    const pressables = root.root.findAllByType(Pressable);
    const card1 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 1')
    );
    await act(async () => {
      card1.props.onLongPress();
    });

    const mergeBtn = root.root.findByProps({ label: 'Merge Selected' });
    expect(mergeBtn.props.disabled).toBe(true);

    const card2 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Snippet 2')
    );
    await act(async () => {
      card2.props.onPress();
    });

    expect(mergeBtn.props.disabled).toBe(false);

    const mergeSpy = jest.spyOn(ClipService, 'mergeClips').mockResolvedValue(undefined);

    await act(async () => {
      await mergeBtn.props.onPress();
    });

    expect(mergeSpy).toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('2 clip(s) merged!', ToastAndroid.SHORT);
  });

  it('combines text clips into one text box when combine is turned on', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValue({ // verify: one new combined text element persisted
        success: true,
        result: [
          { uuid: 'combined-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 500 } } },
        ],
      });

    await ClipService.addClip('First clip.', 'Doc A');
    await ClipService.addClip('Second clip.', 'Doc A');

    const root = await renderApp();
    // Combine is off by default now — turn it on for this test.
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });
    await act(async () => { root.root.findByProps({ testID: 'setting-combine' }).props.onPress(); });

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // One insertText call carrying both clips, separated by a blank line.
    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(1);
    const content = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0].textContentFull;
    expect(['First clip.\n\nSecond clip.', 'Second clip.\n\nFirst clip.']).toContain(content);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clips inserted successfully!', ToastAndroid.SHORT);
    expect(ClipService.getClipsSync().length).toBe(0); // both removed
  });

  it('uses labeled links in combine mode so stacked links stay identifiable', async () => {
    const { PluginNoteAPI, PluginFileAPI, FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValue({
        success: true,
        result: [{ uuid: 'combined', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 400 } } }],
      });

    const testClips: ClipItem[] = [
      { id: 'k1', text: 'From physics', elements: [{ type: 'text', text: 'From physics', documentPath: '/sdcard/Books/physics.pdf', documentPage: 4, articleName: 'physics.pdf' }], articleName: 'physics.pdf', timestamp: 100 },
      { id: 'k2', text: 'From biology', elements: [{ type: 'text', text: 'From biology', documentPath: '/sdcard/Books/biology.pdf', documentPage: 9, articleName: 'biology.pdf' }], articleName: 'biology.pdf', timestamp: 200 },
    ];
    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);

    const root = await renderApp();
    // Turn combine on.
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });
    await act(async () => { root.root.findByProps({ testID: 'setting-combine' }).props.onPress(); });

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => { await insertBtn.props.onPress(); });

    // Both sources get a labeled link (not a bare icon).
    const linkTexts = (PluginNoteAPI.insertTextLink as jest.Mock).mock.calls.map((c) => c[0].showText);
    expect(linkTexts).toContain('[physics, p. 5 ↗]');
    expect(linkTexts).toContain('[biology, p. 10 ↗]');
  });

  it('inserts each text clip as its own box (combine off by default)', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'b1', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } } },
          { uuid: 'b2', type: 500, textBox: { textRect: { left: 100, top: 260, right: 1304, bottom: 360 } } },
        ],
      });

    await ClipService.addClip('First clip.', 'Doc A');
    await ClipService.addClip('Second clip.', 'Doc A');

    const root = await renderApp();

    // Combine is off by default — no toggle needed.
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Two separate boxes.
    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(2);
  });

  it('stacks a figure and text on the same page (positioned image)', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValue({ // post-insert: both a text box and a picture persisted
        success: true,
        result: [
          { uuid: 'txt', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } } },
          { uuid: 'fig', type: 200, picture: { rect: { left: 100, top: 260, right: 700, bottom: 700 } } },
        ],
      });

    await ClipService.addClip('Some text.', 'Doc A');
    await ClipService.addImageClip('/path/to/figure.png', 'Doc A', 400, 300);

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Both the text and the figure are placed on the same page; the image is repositioned
    // (modifyElements) rather than left centered — they no longer require separate pages.
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    expect(PluginNoteAPI.insertImage).toHaveBeenCalled();
    expect(PluginFileAPI.modifyElements).toHaveBeenCalled();
    expect(ClipService.getClipsSync().length).toBe(0); // both inserted + removed
  });

  it('allows selecting a figure together with text (mixed selection)', async () => {
    await ClipService.addClip('A text clip', 'Doc A');
    await ClipService.addImageClip('/path/to/fig.png', 'Doc A');

    const root = await renderApp();
    const cards = () => root.root.findAllByType(Pressable).filter((p: any) => typeof p.props.onLongPress === 'function');
    const textCard = cards().find((p: any) => p.findAllByType(Text).some((t: any) => t.props.children === 'A text clip'));
    const imageCard = cards().find((p: any) => p !== textCard);

    // Start selection on the text clip, then add the image → now allowed (both selected).
    await act(async () => { textCard.props.onLongPress(); });
    await act(async () => { imageCard.props.onPress(); });
    const subtitle = () => root.root.findAllByType(Text).find(
      (t: any) => typeof t.props.children === 'string' && t.props.children.includes('clip(s) selected'),
    );
    expect(subtitle()?.props.children).toBe('2 of 2 clip(s) selected');
    // Mixed selection: Copy enabled (there is text to copy), Merge disabled (has a figure).
    expect(root.root.findByProps({ label: 'Copy Selected' }).props.disabled).toBe(false);
    expect(root.root.findByProps({ label: 'Merge Selected' }).props.disabled).toBe(true);
    expect(root.root.findByProps({ label: 'Insert into open Note' }).props.disabled).toBeFalsy();
  });

  it('disables Copy for an image-only selection but allows Insert; enables Copy once text is added', async () => {
    await ClipService.addClip('A text clip', 'Doc A');
    await ClipService.addImageClip('/path/to/fig.png', 'Doc A');

    const root = await renderApp();
    const cards = () => root.root.findAllByType(Pressable).filter((p: any) => typeof p.props.onLongPress === 'function');
    const textCard = cards().find((p: any) => p.findAllByType(Text).some((t: any) => t.props.children === 'A text clip'));
    const imageCard = cards().find((p: any) => p !== textCard);

    // Figure alone: no text → Copy disabled, Insert enabled, Merge disabled.
    await act(async () => { imageCard.props.onLongPress(); });
    expect(root.root.findByProps({ label: 'Copy Selected' }).props.disabled).toBe(true);
    expect(root.root.findByProps({ label: 'Insert into open Note' }).props.disabled).toBeFalsy();
    expect(root.root.findByProps({ label: 'Merge Selected' }).props.disabled).toBe(true);

    // Add the text clip → Copy becomes enabled (text present); Merge still disabled (figure).
    await act(async () => { textCard.props.onPress(); });
    expect(root.root.findByProps({ label: 'Copy Selected' }).props.disabled).toBe(false);
    expect(root.root.findByProps({ label: 'Merge Selected' }).props.disabled).toBe(true);
  });

  it('stacks multiple figures on one page', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValue({ // post-insert: both images persisted
        success: true,
        result: [
          { uuid: 'fig-a', type: 200, picture: { rect: { left: 100, top: 100, right: 500, bottom: 400 } } },
          { uuid: 'fig-b', type: 200, picture: { rect: { left: 100, top: 450, right: 500, bottom: 750 } } },
        ],
      });

    await ClipService.addImageClip('/path/to/figureA.png', 'Doc A', 400, 300);
    await ClipService.addImageClip('/path/to/figureB.png', 'Doc A', 400, 300);

    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Both figures are placed on the same page (stacked + positioned), not one-per-page.
    expect(PluginNoteAPI.insertImage).toHaveBeenCalledTimes(2);
    expect(PluginFileAPI.modifyElements).toHaveBeenCalledTimes(2);
    expect(ClipService.getClipsSync().length).toBe(0); // both inserted + removed
  });

  it('splits a clip too long for one page, inserting one chunk and keeping the remainder when page addition declined', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValueOnce({ // verify: the inserted chunk persisted
        success: true,
        result: [
          { uuid: 'chunk-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1700 } } },
        ],
      });

    // ~90 sentences → well over one page of text, with clean sentence boundaries to split on.
    const sentences = Array.from({ length: 90 }, (_, i) => `This is sentence number ${i}.`).join(' ');
    await ClipService.addClip(sentences, 'Doc A');
    const originalLen = ClipService.getClipsSync()[0].text.length;

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    const insertPromise = insertBtn.props.onPress();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // Confirmation dialog appears for past-last-page overflow; user cancels/declines
    await act(async () => {
      const dialog = root.root.findByType(ConfirmationDialog);
      dialog.props.onCancel();
      await insertPromise;
    });

    // Exactly one chunk is inserted this pass.
    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(1);
    const inserted = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0].textContentFull;
    expect(inserted.length).toBeLessThan(originalLen); // only part of the clip
    expect(sentences.startsWith(inserted)).toBe(true); // leading chunk

    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'Clip too long for one page — inserted part. Turn to a new page, then Insert again to continue.',
      ToastAndroid.LONG
    );

    // The clip stays in Clipper, now holding only the un-inserted remainder.
    const clips = ClipService.getClipsSync();
    expect(clips.length).toBe(1);
    expect(clips[0].text.length).toBeLessThan(originalLen);
    expect(clips[0].text.length).toBeGreaterThan(0);
    expect(sentences.endsWith(clips[0].text)).toBe(true); // remainder is the tail
  });

  it('auto-turns to next page via jumpToPage without dialog when next page exists', async () => {
    const { PluginNoteAPI, PluginFileAPI, PluginCommAPI } = require('sn-plugin-lib');
    // Note has 2 total pages, starting on page 0
    PluginFileAPI.getNoteTotalPageNum.mockResolvedValue({ success: true, result: 2 });

    // Page 0 is full; page 1 is empty
    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [{ uuid: 'existing', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1800 } } }],
      })
      .mockResolvedValueOnce({
        success: true,
        result: [],
      });

    await ClipService.addClip('Clip that fits on page 2', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Auto-jumped to page 1 (no confirmation dialog needed since page exists)
    expect(PluginCommAPI.jumpToPage).toHaveBeenCalledWith(1);
    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(1);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clips inserted successfully!', ToastAndroid.SHORT);
    expect(ClipService.getClipsSync().length).toBe(0);
  });

  it('shows Page Full modal and preserves queued clips when overflowing past the last page', async () => {
    const { PluginNoteAPI, PluginFileAPI, PluginManager } = require('sn-plugin-lib');
    PluginFileAPI.getNoteTotalPageNum.mockResolvedValue({ success: true, result: 1 });

    // Page 0 is full
    PluginFileAPI.getElements.mockResolvedValue({
      success: true,
      result: [{ uuid: 'existing', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1800 } } }],
    });

    await ClipService.addClip('Clip overflowing last page', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    const insertPromise = insertBtn.props.onPress();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // Page Full modal appears; user taps OK
    await act(async () => {
      const dialog = root.root.findByType(ConfirmationDialog);
      expect(dialog.props.title).toBe('Page Full');
      expect(dialog.props.confirmLabel).toBe('OK');
      dialog.props.onConfirm();
      await insertPromise;
    });

    expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).toHaveBeenCalled();
    // Clip remains queued in Clipper
    const clips = ClipService.getClipsSync();
    expect(clips.length).toBe(1);
    expect(clips[0].text).toBe('Clip overflowing last page');
  });

  it('splits long clip and trims to remainder when overflowing past last page', async () => {
    const { PluginNoteAPI, PluginFileAPI, PluginManager } = require('sn-plugin-lib');
    PluginFileAPI.getNoteTotalPageNum.mockResolvedValue({ success: true, result: 1 });

    // Page 0 has some space for first chunk
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValueOnce({
        success: true,
        result: [{ uuid: 'chunk-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1700 } } }],
      });

    const sentences = Array.from({ length: 90 }, (_, i) => `This is sentence number ${i}.`).join(' ');
    await ClipService.addClip(sentences, 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    const insertPromise = insertBtn.props.onPress();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // Page Full modal appears for remaining portion; user taps OK
    await act(async () => {
      const dialog = root.root.findByType(ConfirmationDialog);
      expect(dialog.props.title).toBe('Page Full');
      dialog.props.onConfirm();
      await insertPromise;
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(1); // chunk 1 on page 0
    expect(PluginManager.closePluginView).toHaveBeenCalled();
    // Remainder stays queued in Clipper
    const clips = ClipService.getClipsSync();
    expect(clips.length).toBe(1);
    expect(clips[0].text).toContain('This is sentence number');
  });

  it('stacks a new image below existing content on the page', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    // Scan finds a picture already on the page; after insert, the new one is also present.
    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          { uuid: 'existing-fig', type: 200, picture: { rect: { left: 100, top: 100, right: 700, bottom: 700 } } },
        ],
      })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'existing-fig', type: 200, picture: { rect: { left: 100, top: 100, right: 700, bottom: 700 } } },
          { uuid: 'new-fig', type: 200, picture: { rect: { left: 100, top: 740, right: 500, bottom: 1040 } } },
        ],
      });

    await ClipService.addImageClip('/path/to/figureC.png', 'Doc A', 400, 300);

    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // The new image is inserted below the existing one (not deferred) and repositioned.
    expect(PluginNoteAPI.insertImage).toHaveBeenCalled();
    expect(PluginFileAPI.modifyElements).toHaveBeenCalled();
    expect(ClipService.getClipsSync().length).toBe(0); // inserted + removed
  });

  it('alerts Page Full and closes cleanly when a clip does not fit past last page', async () => {
    const { PluginFileAPI, PluginNoteAPI, PluginManager } = require('sn-plugin-lib');
    // Existing content fills nearly the whole page, so the new clip cannot fit.
    PluginFileAPI.getElements.mockResolvedValueOnce({
      success: true,
      result: [
        {
          type: 500,
          textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1800 } },
        },
      ],
    });

    await ClipService.addClip('Bounds test snippet', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    const insertPromise = insertBtn.props.onPress();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    await act(async () => {
      const dialog = root.root.findByType(ConfirmationDialog);
      expect(dialog.props.title).toBe('Page Full');
      dialog.props.onConfirm();
      await insertPromise;
    });

    // Nothing is placed off-page; the user is told to add a page instead.
    expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    expect(PluginManager.closePluginView).toHaveBeenCalled();
  });

  it('ignores deleted elements (status !== 0) when calculating starting Y coordinate', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 500,
            status: 2,
            textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 1500 } },
          },
          {
            type: 500,
            status: 0,
            textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } },
          },
        ],
      });

    await ClipService.addClip('Active clip snippet', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // The text must start just below the ACTIVE element (bottom 200), proving the deleted
    // element (bottom 1500) was ignored in the starting-Y calculation.
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBeGreaterThanOrEqual(200);
    expect(call.textRect.top).toBeLessThan(300);
  });

  it('respects stroke elements within valid bounds when calculating starting Y coordinate', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');

    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 0, // TYPE_STROKE (handwriting)
            status: 0,
            maxY: 450,
          },
        ],
      })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'new-txt-uuid', type: 500, textBox: { textRect: { left: 100, top: 480, right: 1304, bottom: 580 } } },
        ],
      });

    await ClipService.addClip('Test snippet', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Insertion should start below the stroke (450 + 32 gap = 482)
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBe(482);
  });

  it('ignores out-of-bounds stroke noise when calculating starting Y coordinate', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');

    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 0, // TYPE_STROKE out of bounds (> 1872 - 120)
            status: 0,
            maxY: 1800,
          },
        ],
      })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'new-txt-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } } },
        ],
      });

    await ClipService.addClip('Test snippet', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Out-of-bounds stroke noise is ignored, starts at top (100)
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBe(100);
  });

  it('handles title (heading) elements when calculating starting Y coordinate', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');

    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 100, // TYPE_TITLE (heading)
            status: 0,
            title: {
              Y: 100,
              height: 80,
            },
          },
        ],
      })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'new-txt-uuid', type: 500, textBox: { textRect: { left: 100, top: 180, right: 1304, bottom: 280 } } },
        ],
      });

    await ClipService.addClip('Test snippet', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Insertion should start below title: Y = 100 + 80 + gap. gap = round(lineHeight*0.6)
    // = round(round(44*1.2)*0.6) = round(53*0.6) = 32 → 212.
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBe(212);
  });

  it('ignores a link element with a bogus off-page maxY when calculating starting Y', async () => {
    // Regression: inserted ↗ link elements return as type 600 with maxY≈16224 on a ~1872-tall
    // page. Trusting that maxY pushed the start-Y off-page so nothing "fit" → premature
    // "turn to a new page". The start-Y must come from the real text box (bottom 500), not the link.
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          { uuid: 'tb1', type: 500, status: 0, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 500 } } },
          { uuid: 'lk1', type: 600, status: 0, maxY: 16224 }, // link with garbage maxY
        ],
      })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'new', type: 500, textBox: { textRect: { left: 100, top: 500, right: 1304, bottom: 600 } } },
        ],
      });

    await ClipService.addClip('A fresh snippet to append', 'Doc A');
    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => { await insertBtn.props.onPress(); });

    // The clip must actually be inserted (not deferred), just below the text box (~500+gap),
    // NOT off the page.
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBeGreaterThanOrEqual(500);
    expect(call.textRect.top).toBeLessThan(700);
  });

  it('inserts selected clips sequentially into active note', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValue({ // post-insert reads: the inserted text persisted
        success: true,
        result: [
          { uuid: 'sel-text-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 270 } } },
        ],
      });
    await ClipService.addClip('Selected textbox snippet', 'Doc A');
    await ClipService.addClip('Unselected snippet', 'Doc A');

    const root = await renderApp();

    const pressables = root.root.findAllByType(Pressable);
    const card1 = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Selected textbox snippet')
    );
    await act(async () => {
      card1.props.onLongPress();
    });

    const insertSelectedBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertSelectedBtn.props.onPress();
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalledWith(expect.objectContaining({
      textContentFull: 'Selected textbox snippet'
    }));
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clips inserted successfully!', ToastAndroid.SHORT);
  });

  it('opens the settings popover with auto-remove on by default', async () => {
    const root = await renderApp();

    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => {
      settingsBtn.props.onPress();
    });

    // Popover header + toggle row render
    const header = root.root.findAllByProps({ children: 'Settings' });
    expect(header.length).toBeGreaterThanOrEqual(1);
    const toggleRow = root.root.findByProps({ testID: 'setting-auto-remove' });
    expect(toggleRow).toBeTruthy();
    // Font-size preset rows are present.
    expect(root.root.findByProps({ testID: 'setting-font-small' })).toBeTruthy();
    expect(root.root.findByProps({ testID: 'setting-font-medium' })).toBeTruthy();
    expect(root.root.findByProps({ testID: 'setting-font-large' })).toBeTruthy();
    // Source-reference toggles are present.
    expect(root.root.findByProps({ testID: 'setting-show-source' })).toBeTruthy();
    expect(root.root.findByProps({ testID: 'setting-insert-source-link' })).toBeTruthy();
  });

  it('resets all settings to defaults via Reset to default', async () => {
    const root = await renderApp();
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });

    // Turn a few settings away from their defaults.
    await act(async () => { root.root.findByProps({ testID: 'setting-combine' }).props.onPress(); });
    await act(async () => { root.root.findByProps({ testID: 'setting-show-source' }).props.onPress(); });
    await act(async () => { root.root.findByProps({ testID: 'setting-font-large' }).props.onPress(); });
    expect(await StorageService.getCombineInserted()).toBe(true); // default off → toggled on
    expect(await StorageService.getShowSourceInClipper()).toBe(false);
    expect(await StorageService.getInsertFontSize()).toBe(56);

    // Reset restores every default.
    await act(async () => { root.root.findByProps({ testID: 'setting-reset' }).props.onPress(); });
    expect(await StorageService.getCombineInserted()).toBe(false); // back to default (off)
    expect(await StorageService.getShowSourceInClipper()).toBe(true);
    expect(await StorageService.getInsertSourceLink()).toBe(true);
    expect(await StorageService.getAutoRemoveInserted()).toBe(true);
    expect(await StorageService.getInsertFontSize()).toBe(44);
  });

  it('persists the source-reference toggles when tapped', async () => {
    const root = await renderApp();
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });

    const showSourceRow = root.root.findByProps({ testID: 'setting-show-source' });
    await act(async () => { showSourceRow.props.onPress(); });
    expect(await StorageService.getShowSourceInClipper()).toBe(false);

    const linkRow = root.root.findByProps({ testID: 'setting-insert-source-link' });
    await act(async () => { linkRow.props.onPress(); });
    expect(await StorageService.getInsertSourceLink()).toBe(false);
  });

  it('hides the Clipper jump icon when Show-source is off', async () => {
    jest.spyOn(StorageService, 'getShowSourceInClipper').mockResolvedValue(false);
    const testClips: ClipItem[] = [
      {
        id: 'cs1',
        text: 'Highlight with a source',
        elements: [{
          type: 'text',
          text: 'Highlight with a source',
          documentPath: '/sdcard/Books/existing.pdf',
          documentPage: 5,
          articleName: 'existing.pdf',
        }],
        articleName: 'existing.pdf',
        timestamp: 100,
      },
    ];
    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    expect(root.root.findAllByProps({ testID: 'jump-btn' }).length).toBe(0);
  });

  it('persists a chosen inserted-text font size', async () => {
    const root = await renderApp();
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });

    const largeRow = root.root.findByProps({ testID: 'setting-font-large' });
    await act(async () => { largeRow.props.onPress(); });

    expect(await StorageService.getInsertFontSize()).toBe(56);
  });

  it('unmerges a merged clip back into its individual pieces', async () => {
    const mockClips = [
      {
        id: 'merged',
        text: 'Part one\n\nPart two',
        elements: [
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
        articleName: 'Doc A',
        timestamp: 100,
      },
    ];
    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(mockClips);

    const root = await renderApp();

    // Enter selection mode and select the merged clip.
    const pressables = root.root.findAllByType(Pressable);
    const card = pressables.find((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'Part one')
    );
    await act(async () => { card.props.onLongPress(); });

    const unmergeBtn = root.root.findByProps({ label: 'Unmerge' });
    expect(unmergeBtn.props.disabled).toBe(false);
    await act(async () => { await unmergeBtn.props.onPress(); });

    const clips = ClipService.getClipsSync();
    expect(clips.length).toBe(2);
    expect(clips.every((c) => c.elements.length === 1)).toBe(true);
  });

  it('keeps inserted clips in Clipper when auto-remove is turned off', async () => {
    const { PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      .mockResolvedValue({ // post-insert reads: the inserted text persisted
        success: true,
        result: [
          { uuid: 'kept-text-uuid', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 270 } } },
        ],
      });

    await ClipService.addClip('Snippet to keep', 'Doc A');
    const deleteSpy = jest.spyOn(ClipService, 'deleteClips');

    const root = await renderApp();

    // Turn the auto-remove setting off
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => {
      settingsBtn.props.onPress();
    });
    const toggleRow = root.root.findByProps({ testID: 'setting-auto-remove' });
    await act(async () => {
      toggleRow.props.onPress();
    });

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Inserted clips are NOT removed, and the toast reflects that.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(ClipService.getClipsSync().length).toBe(1);
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clips inserted (kept in Clipper)', ToastAndroid.SHORT);
  });

  it('ignores a second Insert tap while an insert is already running (no duplicate)', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValue({
        success: true,
        result: [{ uuid: 'one', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } } }],
      });

    await ClipService.addClip('Only once please', 'Doc A');
    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });

    // Fire two taps back-to-back without awaiting the first; the second must be blocked.
    await act(async () => {
      const p1 = insertBtn.props.onPress();
      const p2 = insertBtn.props.onPress();
      await Promise.all([p1, p2]);
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(1); // not 2
  });

  it('reads auto-remove fresh from storage at insert time (not stale default state)', async () => {
    // Regression: the settings state defaults to auto-remove ON and loads async; a very early
    // insert (e.g. right after a plugin update) must still honor the saved "off" from storage,
    // not delete clips. Here storage says off but the UI was never touched.
    const { PluginFileAPI } = require('sn-plugin-lib');
    jest.spyOn(StorageService, 'getAutoRemoveInserted').mockResolvedValue(false);
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValue({
        success: true,
        result: [{ uuid: 'kept', type: 500, textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 270 } } }],
      });

    await ClipService.addClip('Should be kept', 'Doc A');
    const deleteSpy = jest.spyOn(ClipService, 'deleteClips');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => { await insertBtn.props.onPress(); });

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(ClipService.getClipsSync().length).toBe(1);
  });

  it('handles search and filtering popovers correctly', async () => {
    await ClipService.addClip('QueryTarget text', 'Document A');
    await ClipService.addClip('Another clip content', 'Document B');

    const root = await renderApp();

    // Toggle search bar
    const searchBtn = root.root.findByProps({ testID: 'search-btn' });
    await act(async () => {
      searchBtn.props.onPress();
    });

    const searchInput = root.root.findByType(TextInput);
    await act(async () => {
      searchInput.props.onChangeText('QueryTarget');
    });

    // Check that only 1 card is displayed
    const pressables = root.root.findAllByType(Pressable);
    const filteredCards = pressables.filter((p: any) =>
      p.findAllByType(Text).some((t: any) => t.props.children === 'QueryTarget text')
    );
    expect(filteredCards.length).toBe(1);

    // Toggle popover filter
    const filterBtn = root.root.findByProps({ testID: 'filter-btn' });
    await act(async () => {
      filterBtn.props.onPress();
    });

    // Filter should render popover
    const popoverHeader = root.root.findAllByProps({ children: 'Filter by Source' });
    expect(popoverHeader.length).toBeGreaterThanOrEqual(1);
  });

  it('handles custom page cropping flow successfully', async () => {
    const { PluginCommAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/Manual.pdf' });
    ClipService.setPendingCropShot({
      path: '/tmp/test_crop.png',
      width: 1404,
      height: 1872,
      ts: Date.now(),
    });
    await ClipService.setLaunchMode('crop');
    const root = await renderApp();

    // Flush promises (wait for sequential awaits in handleStartCropping)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Check workspace renders (loading finished since we mocked it)
    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();

    // Trigger workspace layout to set sizes
    await act(async () => {
      workspace.props.onLayout({
        nativeEvent: {
          layout: { width: 400, height: 600 }
        }
      });
    });

    // The box (rendered first) plus its 8 resize handles all carry touch handlers.
    const touchTargets = root.root.findAll((el) => typeof el.props.onTouchStart === 'function' && typeof el.props.onTouchMove === 'function');
    expect(touchTargets.length).toBe(9); // 1 box + 8 handles
    const cropBoxElement = touchTargets[0];

    // Exercise a resize handle first (handles are mounted while not body-dragging):
    // start + move drives getResizeStart/onResizeMove and the clamp math.
    const resizeHandle = touchTargets[1];
    await act(async () => {
      resizeHandle.props.onTouchStart({ nativeEvent: { pageX: 300, pageY: 450 }, stopPropagation: () => {} });
      resizeHandle.props.onTouchMove({ nativeEvent: { pageX: 320, pageY: 470 }, stopPropagation: () => {} });
      resizeHandle.props.onTouchEnd({ nativeEvent: {}, stopPropagation: () => {} });
    });

    // Then drag the whole box (this hides the handles via isDraggingBody).
    await act(async () => {
      cropBoxElement.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } });
      cropBoxElement.props.onTouchMove({ nativeEvent: { pageX: 120, pageY: 130 } });
      cropBoxElement.props.onTouchEnd({ nativeEvent: {} });
    });

    // Save crop
    const saveBtn = root.root.findByProps({ label: 'Clip selected region' });
    await act(async () => {
      saveBtn.props.onPress();
    });

    // Should return to list mode
    const titleText = root.root.findByProps({ children: 'Clipper' });
    expect(titleText).toBeTruthy();
  });

  it('handles sorting options, chips clearing, empty list, and crop cancel', async () => {
    // 1. Empty list rendering
    const rootEmpty = await renderApp();
    const emptyText = rootEmpty.root.findByProps({ children: 'No clippings aggregated yet. Highlight text to begin.' });
    expect(emptyText).toBeTruthy();

    // 2. Add some clips (wrapped in act because rootEmpty is still mounted and listening)
    await act(async () => {
      await ClipService.addClip('Text clip Alpha', 'Book1.pdf');
      await ClipService.addClip('Text clip Beta', 'Book2.pdf');
    });

    const root = await renderApp();

    // 3. Search and click clear button
    const searchBtn = root.root.findByProps({ testID: 'search-btn' });
    await act(async () => {
      searchBtn.props.onPress();
    });
    const searchInput = root.root.findByType(TextInput);
    await act(async () => {
      searchInput.props.onChangeText('Alpha');
    });

    // Clear search using clear button in search input bar
    const clearBtn = root.root.find((el) => el.props.style && el.props.style.paddingHorizontal === 12 && el.props.style.height === '100%' && el.props.onPress);
    if (clearBtn) {
      await act(async () => {
        clearBtn.props.onPress();
      });
    }

    // 4. Popover filters
    const filterBtn = root.root.findByProps({ testID: 'filter-btn' });
    await act(async () => {
      filterBtn.props.onPress();
    });

    // Click Oldest First
    const oldestRow = root.root.find((el) => el.props.children && el.props.children[0] && el.props.children[0].props && el.props.children[0].props.children === 'Oldest First');
    if (oldestRow) {
      await act(async () => {
        oldestRow.props.onPress();
      });
    }

    // Click All Sources in filter
    await act(async () => {
      filterBtn.props.onPress();
    });
    const allSourcesRow = root.root.find((el) => el.props.children && el.props.children[0] && el.props.children[0].props && el.props.children[0].props.children === 'All Sources');
    if (allSourcesRow) {
      await act(async () => {
        allSourcesRow.props.onPress();
      });
    }

    // 5. Crop cancel
    ClipService.setPendingCropShot({
      path: '/tmp/test_crop.png',
      width: 1404,
      height: 1872,
      ts: Date.now(),
    });
    await ClipService.setLaunchMode('crop');
    const rootCrop = await renderApp();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const cancelCropBtn = rootCrop.root.find((el) => el.props.children && el.props.children.props && el.props.children.props.children === 'Cancel');
    if (cancelCropBtn) {
      await act(async () => {
        cancelCropBtn.props.onPress();
      });
    }
    const titleText = rootCrop.root.findByProps({ children: 'Clipper' });
    expect(titleText).toBeTruthy();
  });

  it('shows selection prompt modal when launched in prompt mode, and handles Clip as Text', async () => {
    const { PluginManager } = require('sn-plugin-lib');

    await ClipService.setPromptText('Short selection text');
    await ClipService.setLaunchMode('prompt');
    const root = await renderApp();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Modal should render
    const titleText = root.root.findByProps({ children: 'Clip Selection' });
    expect(titleText).toBeTruthy();

    // Tap Clip as Text button
    const clipAsTextBtn = root.root.find(
      (el) =>
        el.props.style &&
        el.props.onPress &&
        el.findAllByType(Text).some((t: any) => t.props.children === 'Clip Text')
    );
    expect(clipAsTextBtn).toBeTruthy();

    await act(async () => {
      await clipAsTextBtn.props.onPress();
    });

    // Check it calls ClipService and closePluginView/exitApp
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      expect.stringContaining('Clipped as Text!'),
      ToastAndroid.SHORT
    );
  });

  it('keeps the prompt open when a follow-up context check runs (AppState active race)', async () => {
    await ClipService.setPromptText('Short selection text');
    await ClipService.setLaunchMode('prompt');
    const root = await renderApp();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Prompt is shown; launch mode has now been consumed to 'normal'.
    expect(root.root.findByProps({ children: 'Clip Selection' })).toBeTruthy();

    // Simulate the AppState 'active' event firing a second context check — it reads the
    // already-consumed 'normal' mode. The prompt must NOT be dismissed (the regression).
    await act(async () => {
      const cb = (globalThis as any).__appStateCb;
      if (cb) cb('active');
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(root.root.findByProps({ children: 'Clip Selection' })).toBeTruthy();
  });

  it('keeps the crop overlay open when a follow-up context check runs (AppState active race)', async () => {
    const { PluginCommAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/Manual.pdf' });
    ClipService.setPendingCropShot({
      path: '/tmp/test_crop.png',
      width: 1404,
      height: 1872,
      ts: Date.now(),
    });
    await ClipService.setLaunchMode('crop');
    const root = await renderApp();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Crop overlay is shown
    expect(root.root.find((el) => typeof el.props.onLayout === 'function')).toBeTruthy();

    // Simulate AppState 'active' firing a second context check
    await act(async () => {
      const cb = (globalThis as any).__appStateCb;
      if (cb) cb('active');
      await new Promise((r) => setTimeout(r, 50));
    });

    // Crop overlay must still be active (not dismissed to dashboard)
    expect(root.root.find((el) => typeof el.props.onLayout === 'function')).toBeTruthy();
  });

  it('shows selection prompt modal and handles Clip as Image', async () => {
    const { PluginCommAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/Manual.pdf' });
    ClipService.setPendingCropShot({
      path: '/tmp/test_crop.png',
      width: 1404,
      height: 1872,
      ts: Date.now(),
    });
    await ClipService.setPromptText('Short selection text');
    await ClipService.setLaunchMode('prompt');
    const root = await renderApp();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const clipAsImageBtn = root.root.find(
      (el) =>
        el.props.style &&
        el.props.onPress &&
        el.findAllByType(Text).some((t: any) => t.props.children === 'Clip Region')
    );
    expect(clipAsImageBtn).toBeTruthy();

    await act(async () => {
      await clipAsImageBtn.props.onPress();
    });

    // Should proceed to crop workspace
    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();
  });

  it('inserts native TextLinks in runInsertClips when clips have document metadata', async () => {
    const { PluginNoteAPI, FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);

    const testClips: ClipItem[] = [
      {
        id: 'c1',
        text: 'Link highlight text',
        elements: [{
          type: 'text',
          text: 'Link highlight text',
          documentPath: '/sdcard/Books/physics.pdf',
          documentPage: 4,
          articleName: 'physics.pdf',
        }],
        articleName: 'physics.pdf',
        timestamp: 100,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    expect(insertBtn).toBeTruthy();

    await act(async () => {
      await insertBtn.props.onPress();
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    // The tap target (path/page/linkType) is preserved; the label is now just a jump icon.
    expect(PluginNoteAPI.insertTextLink).toHaveBeenCalledWith(
      expect.objectContaining({
        destPath: '/sdcard/Books/physics.pdf',
        destPage: 4,
        linkType: 2,
        showText: '↗',
        fullText: '↗',
      })
    );
  });

  it('does not insert a source link when Link-source is off', async () => {
    const { PluginNoteAPI, FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    jest.spyOn(StorageService, 'getInsertSourceLink').mockResolvedValue(false);

    const testClips: ClipItem[] = [
      {
        id: 'cl1',
        text: 'Link highlight text',
        elements: [{
          type: 'text',
          text: 'Link highlight text',
          documentPath: '/sdcard/Books/physics.pdf',
          documentPage: 4,
          articleName: 'physics.pdf',
        }],
        articleName: 'physics.pdf',
        timestamp: 100,
      },
    ];
    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    expect(PluginNoteAPI.insertTextLink).not.toHaveBeenCalled();
  });

  it('places the jump icon inline on the last text line at the right margin', async () => {
    const { PluginNoteAPI, FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);

    const testClips: ClipItem[] = [
      {
        id: 'c3',
        text: 'Short highlight',
        elements: [{
          type: 'text',
          text: 'Short highlight',
          documentPath: '/sdcard/Books/physics.pdf',
          documentPage: 4,
          articleName: 'physics.pdf',
        }],
        articleName: 'physics.pdf',
        timestamp: 100,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    const lineHeight = Math.round(44 * 1.2);
    const boxCall = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    const linkCall = (PluginNoteAPI.insertTextLink as jest.Mock).mock.calls[0][0];
    // Icon right edge is pinned to the text box's right margin.
    expect(linkCall.rect.right).toBe(boxCall.textRect.right);
    // A 15-char clip is one line, so the icon sits ON that line (near the box top), not on a
    // separate line below it.
    expect(linkCall.rect.top - boxCall.textRect.top).toBeLessThan(lineHeight);
  });

  it('skips TextLinks in runInsertClips and cleans up storage when file is missing', async () => {
    const { PluginNoteAPI, FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(false);

    const testClips: ClipItem[] = [
      {
        id: 'c2',
        text: 'Missing file highlight text',
        elements: [{
          type: 'text',
          text: 'Missing file highlight text',
          documentPath: '/sdcard/Books/deleted.pdf',
          documentPage: 9,
          articleName: 'deleted.pdf',
        }],
        articleName: 'deleted.pdf',
        timestamp: 200,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const removeLinkSpy = jest.spyOn(ClipService, 'removeLinkFromElement');
    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });

    await act(async () => {
      await insertBtn.props.onPress();
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    expect(PluginNoteAPI.insertTextLink).not.toHaveBeenCalled();
    expect(removeLinkSpy).toHaveBeenCalledWith('c2', 0);
  });

  it('calls ImageCropModule.openFileDirectly with path and page when clicking Jump on an existing file', async () => {
    const { FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);

    const testClips: ClipItem[] = [
      {
        id: 'c4',
        text: 'Existing file highlight',
        elements: [{
          type: 'text',
          text: 'Existing file highlight',
          documentPath: '/sdcard/Books/existing.pdf',
          documentPage: 5,
          articleName: 'existing.pdf',
        }],
        articleName: 'existing.pdf',
        timestamp: 400,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    const { PluginFileAPI } = require('sn-plugin-lib');
    expect(PluginFileAPI.openFile).toHaveBeenCalledWith(
      '/sdcard/Books/existing.pdf',
      5
    );
  });

  it('does not call openFile and shows toast when clicking Jump on the already opened page', async () => {
    const { FileUtils, PluginCommAPI, PluginFileAPI } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/existing.pdf' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 5 });

    const testClips: ClipItem[] = [
      {
        id: 'c5',
        text: 'Existing file highlight',
        elements: [{
          type: 'text',
          text: 'Existing file highlight',
          documentPath: '/sdcard/Books/existing.pdf',
          documentPage: 5,
          articleName: 'existing.pdf',
        }],
        articleName: 'existing.pdf',
        timestamp: 500,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    const { ToastAndroid } = require('react-native');
    expect(PluginFileAPI.openFile).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('Already on this page.', ToastAndroid.SHORT);

    // Restore default mocks
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
  });

  it('short-circuits Jump on the same page of an EPUB file', async () => {
    const { FileUtils, PluginCommAPI, PluginFileAPI } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/existing.epub' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 5 });

    const testClips: ClipItem[] = [
      {
        id: 'c6',
        text: 'EPUB highlight',
        elements: [{
          type: 'text',
          text: 'EPUB highlight',
          documentPath: '/sdcard/Books/existing.epub',
          documentPage: 5,
          articleName: 'existing.epub',
        }],
        articleName: 'existing.epub',
        timestamp: 600,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    const { ToastAndroid } = require('react-native');
    expect(PluginFileAPI.openFile).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('Already on this page.', ToastAndroid.SHORT);

    // Restore default mocks
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
  });

  it('shows password locked toast when jumping to an encrypted document', async () => {
    const { FileUtils, PluginCommAPI, PluginFileAPI } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
    PluginFileAPI.getPathEncryptionStatus.mockResolvedValue({ success: true, result: 1 }); // 1 = encrypted / locked

    const testClips: ClipItem[] = [
      {
        id: 'c-locked',
        text: 'Encrypted document snippet',
        elements: [{
          type: 'text',
          text: 'Encrypted document snippet',
          documentPath: '/sdcard/Books/secret.pdf',
          documentPage: 2,
          articleName: 'secret.pdf',
        }],
        articleName: 'secret.pdf',
        timestamp: 650,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    const { ToastAndroid } = require('react-native');
    expect(PluginFileAPI.openFile).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('This file is locked with a password.', ToastAndroid.LONG);

    // Restore encryption status mock
    PluginFileAPI.getPathEncryptionStatus.mockResolvedValue({ success: true, result: 0 });
  });

  it('shows toast and does not close plugin view when openFile returns generic failure', async () => {
    const { FileUtils, PluginCommAPI, PluginFileAPI, PluginManager } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(true);
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/Other.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
    PluginFileAPI.openFile.mockResolvedValue({ success: false, error: { code: 100, message: 'File not found' } });

    const testClips: ClipItem[] = [
      {
        id: 'c7',
        text: 'Deleted file highlight',
        elements: [{
          type: 'text',
          text: 'Deleted file highlight',
          documentPath: '/sdcard/Books/deleted.pdf',
          documentPage: 2,
          articleName: 'deleted.pdf',
        }],
        articleName: 'deleted.pdf',
        timestamp: 700,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const root = await renderApp();

    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    const { ToastAndroid } = require('react-native');
    expect(PluginFileAPI.openFile).toHaveBeenCalledWith('/sdcard/Books/deleted.pdf', 2);
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'Could not open the source document (it may have been moved or deleted)',
      ToastAndroid.LONG
    );
    expect(PluginManager.closePluginView).not.toHaveBeenCalled();

    // Restore openFile mock
    PluginFileAPI.openFile.mockResolvedValue({ success: true });
  });

  it('runs sweepOrphanCaptures on start and deletes stale files', async () => {
    const { FileUtils } = require('sn-plugin-lib');
    const deleteSpy = jest.spyOn(FileUtils, 'deleteFile').mockResolvedValue(true);
    FileUtils.listFiles.mockResolvedValue([
      '/sdcard/Supernote/Plugins/SnClipper/reader_shot_1000000000000.png',
      '/sdcard/Supernote/Plugins/SnClipper/temp_crop_page_1000000000000.png',
      '/sdcard/Supernote/Plugins/SnClipper/clip_1000000000000.png',
      '/sdcard/Supernote/Plugins/SnClipper/unrelated.png',
    ]);

    await renderApp();

    // Only transient captures are swept.
    expect(deleteSpy).toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/reader_shot_1000000000000.png');
    expect(deleteSpy).toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/temp_crop_page_1000000000000.png');
    // clip_* files are user data (image-clip backing images) and must NEVER be swept, even when
    // stale — deleting them left blank-image clips (data loss).
    expect(deleteSpy).not.toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/clip_1000000000000.png');
    expect(deleteSpy).not.toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/unrelated.png');
    deleteSpy.mockRestore();
    // Reset listFiles mock
    FileUtils.listFiles.mockResolvedValue([]);
  });

  it('triggers confirmation dialog when clicking Jump on missing file and removes link', async () => {
    const { FileUtils } = require('sn-plugin-lib');
    FileUtils.exists.mockResolvedValue(false);

    const testClips: ClipItem[] = [
      {
        id: 'c3',
        text: 'Missing file highlight',
        elements: [{
          type: 'text',
          text: 'Missing file highlight',
          documentPath: '/sdcard/Books/missing.pdf',
          documentPage: 2,
          articleName: 'missing.pdf',
        }],
        articleName: 'missing.pdf',
        timestamp: 300,
      },
    ];

    jest.spyOn(StorageService, 'loadClips').mockResolvedValue(testClips);
    const removeLinkSpy = jest.spyOn(ClipService, 'removeLinkFromElement');
    const root = await renderApp();

    // Find the Jump button inside ClipCard
    const jumpBtn = root.root.find((el: any) => {
      return el.type === 'Pressable' && el.props.testID === 'jump-btn';
    });
    expect(jumpBtn).toBeTruthy();

    await act(async () => {
      await jumpBtn.props.onPress({ stopPropagation: () => {} });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Confirmation dialog should be visible. Find the Remove Link button inside the dialog.
    const removeLinkBtn = root.root.find(
      (el: any) =>
        el.props.style &&
        el.props.onPress &&
        el.findAllByType(Text).some((t: any) => t.props.children === 'Remove Link')
    );
    expect(removeLinkBtn).toBeTruthy();

    await act(async () => {
      await removeLinkBtn.props.onPress();
    });

    expect(removeLinkSpy).toHaveBeenCalledWith('c3', 0);
  });

  it('handles fallback cropping in a note file using generateLayerPreviewImage', async () => {
    const { PluginCommAPI, PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/Meeting.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 2 });
    PluginNoteAPI.generateLayerPreviewImage.mockClear();
    PluginFileAPI.generateNotePng.mockClear();

    // No pending background crop shot (resolves null immediately)
    ClipService.clearPendingCropShot();
    jest.spyOn(ClipService, 'waitForPendingCropShot').mockResolvedValue(null);
    await ClipService.setLaunchMode('crop');

    const root = await renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(PluginNoteAPI.generateLayerPreviewImage).toHaveBeenCalledWith(
      '/sdcard/Notes/Meeting.note',
      2,
      0,
      expect.any(String)
    );
    expect(PluginFileAPI.generateNotePng).not.toHaveBeenCalled();

    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();
  });

  it('falls back to generateNotePng when generateLayerPreviewImage fails for a note file', async () => {
    const { PluginCommAPI, PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/Meeting.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 2 });
    PluginNoteAPI.generateLayerPreviewImage.mockClear();
    PluginNoteAPI.generateLayerPreviewImage.mockResolvedValueOnce({ success: false });
    PluginFileAPI.generateNotePng.mockClear();

    ClipService.clearPendingCropShot();
    jest.spyOn(ClipService, 'waitForPendingCropShot').mockResolvedValue(null);
    await ClipService.setLaunchMode('crop');

    const root = await renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(PluginFileAPI.generateNotePng).toHaveBeenCalledWith(
      expect.objectContaining({
        notePath: '/sdcard/Notes/Meeting.note',
        page: 2,
        times: 1,
        type: 0,
      })
    );

    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();
  });

  it('handles fallback cropping in a doc file using generateCurrentDocImage', async () => {
    const { PluginCommAPI, PluginDocAPI } = require('sn-plugin-lib');
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Books/Manual.pdf' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 5 });
    PluginDocAPI.generateCurrentDocImage.mockClear();

    // No pending background crop shot (resolves null immediately)
    ClipService.clearPendingCropShot();
    jest.spyOn(ClipService, 'waitForPendingCropShot').mockResolvedValue(null);
    await ClipService.setLaunchMode('crop');

    const root = await renderApp();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(PluginDocAPI.generateCurrentDocImage).toHaveBeenCalledWith(
      5,
      expect.stringContaining('temp_crop_page_'),
      expect.objectContaining({ width: 1404, height: 1872 }),
      0
    );

    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();
  });
});
