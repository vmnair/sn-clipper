import React from 'react';
import renderer, { act } from 'react-test-renderer';
import App from '../src/App';
import { ClipService } from '../src/services/ClipService';
import { StorageService, ClipItem } from '../src/services/StorageService';
import { Clipboard, ToastAndroid, Text, Pressable, TextInput } from 'react-native';
import { PluginManager } from 'sn-plugin-lib';

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
      addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    },
    BackHandler: {
      exitApp: jest.fn(),
    },
  };
});

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
    getCurrentPageNum: jest.fn().mockResolvedValue({ success: true, result: 0 }),
  },
  PluginFileAPI: {
    getPageSize: jest.fn().mockResolvedValue({ success: true, result: { width: 1404, height: 1872 } }),
    getLastElement: jest.fn().mockResolvedValue({ success: true, result: { uuid: 'mock-uuid', picture: { rect: { left: 0, top: 0, right: 300, bottom: 300 } } } }),
    getElements: jest.fn().mockResolvedValue({ success: true, result: [] }),
    modifyElements: jest.fn().mockResolvedValue({ success: true }),
    insertElements: jest.fn().mockResolvedValue({ success: true }),
    generateNotePng: jest.fn().mockResolvedValue({ success: true }),
  },
  PluginDocAPI: {
    generateDocImage: jest.fn().mockResolvedValue({ success: true }),
    getLastSelectedText: jest.fn().mockResolvedValue({ success: true, result: '' }),
  },
  PluginNoteAPI: {
    saveCurrentNote: jest.fn().mockResolvedValue({ success: true }),
    insertText: jest.fn().mockResolvedValue({ success: true }),
    insertImage: jest.fn().mockResolvedValue({ success: true, result: { uuid: 'mock-uuid', picture: { rect: { left: 0, top: 0, right: 300, bottom: 300 } } } }),
    insertTextLink: jest.fn().mockResolvedValue({ success: true }),
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
    // getElements is configured per-test with mockResolvedValue(Once); reset it to a clean
    // empty default each time so a persistent mock from one test can't leak into the next.
    const { PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements.mockReset();
    PluginFileAPI.getElements.mockResolvedValue({ success: true, result: [] });
    // Reset persisted settings (combine/font/auto-remove) so they don't leak between tests.
    await require('@react-native-async-storage/async-storage').clear();
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
      await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('combines text clips into one text box (combine on by default)', async () => {
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

  it('inserts each text clip as its own box when combine is turned off', async () => {
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

    // Turn combine off in settings.
    const settingsBtn = root.root.findByProps({ testID: 'settings-btn' });
    await act(async () => { settingsBtn.props.onPress(); });
    const combineRow = root.root.findByProps({ testID: 'setting-combine' });
    await act(async () => { combineRow.props.onPress(); });

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Two separate boxes.
    expect(PluginNoteAPI.insertText).toHaveBeenCalledTimes(2);
  });

  it('never places a figure on a page with text (figure gets its own page)', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'x', type: 200, picture: { rect: { left: 100, top: 100, right: 700, bottom: 700 } } },
        ],
      });

    // Default sort is newest-first, so the image (added last) is processed first onto the
    // empty page, alone; the text is deferred.
    await ClipService.addClip('Some text.', 'Doc A');
    await ClipService.addImageClip('/path/to/figure.png', 'Doc A');

    const root = await renderApp();
    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Text and figure never share a page: exactly one of them is placed this pass, and the
    // other is deferred (kept). (Insertion order depends on the visible sort, so assert the
    // invariant, not which one goes first.)
    const textCalled = (PluginNoteAPI.insertText as jest.Mock).mock.calls.length > 0;
    const imageCalled = (PluginNoteAPI.insertImage as jest.Mock).mock.calls.length > 0;
    expect((textCalled ? 1 : 0) + (imageCalled ? 1 : 0)).toBe(1);
    expect(ClipService.getClipsSync().length).toBe(1); // the deferred clip is kept
  });

  it('a figure can only be selected on its own (blocks mixing with text)', async () => {
    await ClipService.addClip('A text clip', 'Doc A');
    await ClipService.addImageClip('/path/to/fig.png', 'Doc A');

    const root = await renderApp();
    const cards = () => root.root.findAllByType(Pressable).filter((p: any) => typeof p.props.onLongPress === 'function');
    const textCard = cards().find((p: any) => p.findAllByType(Text).some((t: any) => t.props.children === 'A text clip'));
    const imageCard = cards().find((p: any) => p !== textCard);

    // Start selection on the text clip, then try to add the image → blocked (stays 1 text).
    await act(async () => { textCard.props.onLongPress(); });
    await act(async () => { imageCard.props.onPress(); });
    const subtitle = () => root.root.findAllByType(Text).find(
      (t: any) => typeof t.props.children === 'string' && t.props.children.includes('clip(s) selected'),
    );
    expect(subtitle()?.props.children).toBe('1 of 2 clip(s) selected');
    // Selection is text-only → Copy enabled.
    expect(root.root.findByProps({ label: 'Copy Selected' }).props.disabled).toBe(false);
  });

  it('a lone figure selection disables Copy but allows Insert', async () => {
    await ClipService.addClip('A text clip', 'Doc A');
    await ClipService.addImageClip('/path/to/fig.png', 'Doc A');

    const root = await renderApp();
    const cards = () => root.root.findAllByType(Pressable).filter((p: any) => typeof p.props.onLongPress === 'function');
    const textCard = cards().find((p: any) => p.findAllByType(Text).some((t: any) => t.props.children === 'A text clip'));
    const imageCard = cards().find((p: any) => p !== textCard);

    // Select the figure alone, then try to add text → blocked (stays 1 figure).
    await act(async () => { imageCard.props.onLongPress(); });
    await act(async () => { textCard.props.onPress(); });
    const subtitle = root.root.findAllByType(Text).find(
      (t: any) => typeof t.props.children === 'string' && t.props.children.includes('clip(s) selected'),
    );
    expect(subtitle?.props.children).toBe('1 of 2 clip(s) selected');

    expect(root.root.findByProps({ label: 'Copy Selected' }).props.disabled).toBe(true);
    expect(root.root.findByProps({ label: 'Insert into open Note' }).props.disabled).toBeFalsy();
    // Only the figure is selected (text was blocked), so Merge is disabled.
    expect(root.root.findByProps({ label: 'Merge Selected' }).props.disabled).toBe(true);
  });

  it('inserts only one figure per page and keeps the rest in Clipper', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({ success: true, result: [] }) // scan: empty page
      // Post-insert reads: the first image persisted (one new element with an id).
      .mockResolvedValue({
        success: true,
        result: [
          { uuid: 'fig-a-uuid', type: 200, picture: { rect: { left: 100, top: 100, right: 700, bottom: 700 } } },
        ],
      });

    await ClipService.addImageClip('/path/to/figureA.png', 'Doc A');
    await ClipService.addImageClip('/path/to/figureB.png', 'Doc A');

    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Exactly one figure is inserted; the other is deferred to the next page. (Insertion
    // order follows the visible sort, so don't assume which of the two goes first.)
    const bothPaths = ['/path/to/figureA.png', '/path/to/figureB.png'];
    expect(PluginNoteAPI.insertImage).toHaveBeenCalledTimes(1);
    const insertedPath = (PluginNoteAPI.insertImage as jest.Mock).mock.calls[0][0];
    expect(bothPaths).toContain(insertedPath);
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'Figures go on their own page. Turn to a blank page, then Insert to place the figure.',
      ToastAndroid.LONG
    );
    // The deferred figure (the one NOT inserted) remains in Clipper; the inserted one is
    // auto-removed by default.
    const remaining = ClipService.getClipsSync();
    expect(remaining.length).toBe(1);
    const remainingPath = remaining[0].elements.find((e) => e.type === 'image')?.imagePath;
    expect(remainingPath).toBe(bothPaths.find((p) => p !== insertedPath));
  });

  it('splits a clip too long for one page, inserting one chunk and keeping the remainder', async () => {
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
    await act(async () => {
      await insertBtn.props.onPress();
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

  it('defers an image when the page already has one, keeping it in Clipper', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    // Scan finds a picture already on the page (from a previous insert).
    PluginFileAPI.getElements.mockResolvedValueOnce({
      success: true,
      result: [
        { uuid: 'existing-fig', type: 200, picture: { rect: { left: 100, top: 100, right: 700, bottom: 700 } } },
      ],
    });

    await ClipService.addImageClip('/path/to/figureC.png', 'Doc A');

    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // The page already has a figure, so the new one is deferred (never inserted) and kept.
    expect(PluginNoteAPI.insertImage).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'Figures go on their own page. Turn to a blank page, then Insert to place the figure.',
      ToastAndroid.LONG
    );
    expect(ClipService.getClipsSync().length).toBe(1);
  });

  it('alerts to add a page and does not insert when a clip does not fit', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
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
    await act(async () => {
      await insertBtn.props.onPress();
    });

    // Nothing is placed off-page; the user is told to add a page instead.
    expect(PluginNoteAPI.insertText).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'More clips remain. Turn to a new page, then Insert again to continue.',
      ToastAndroid.LONG
    );
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

  it('ignores stroke elements entirely when calculating starting Y coordinate', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');

    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 0, // TYPE_STROKE (handwriting)
            status: 0,
            maxY: 1680,
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

    // Insertion should start at default Y = 100 since the stroke is completely ignored.
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

    // Insertion should start below title: Y = 100 + 80 + gap (35) = 215
    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    const call = (PluginNoteAPI.insertText as jest.Mock).mock.calls[0][0];
    expect(call.textRect.top).toBe(215);
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

  it('shows selection prompt modal and handles Clip as Image', async () => {
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
    expect(PluginNoteAPI.insertTextLink).toHaveBeenCalledWith(
      expect.objectContaining({
        destPath: '/sdcard/Books/physics.pdf',
        destPage: 4,
        linkType: 2,
        fullText: '[physics, p. 5 ↗]',
      })
    );
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

    const { NativeModules } = require('react-native');
    expect(NativeModules.ImageCropModule.openFileDirectly).toHaveBeenCalledWith(
      '/sdcard/Books/existing.pdf',
      5
    );
  });

  it('does not call openFileDirectly and shows toast when clicking Jump on the already opened page', async () => {
    const { FileUtils, PluginCommAPI } = require('sn-plugin-lib');
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

    const { NativeModules, ToastAndroid } = require('react-native');
    expect(NativeModules.ImageCropModule.openFileDirectly).not.toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('Already on this page.', ToastAndroid.SHORT);

    // Restore default mocks
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
  });

  it('calls openFileDirectly and does not show toast when clicking Jump on same page of an EPUB file', async () => {
    const { FileUtils, PluginCommAPI } = require('sn-plugin-lib');
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

    const { NativeModules, ToastAndroid } = require('react-native');
    expect(NativeModules.ImageCropModule.openFileDirectly).toHaveBeenCalledWith(
      '/sdcard/Books/existing.epub',
      5
    );
    expect(ToastAndroid.show).not.toHaveBeenCalledWith('Already on this page.', ToastAndroid.SHORT);

    // Restore default mocks
    PluginCommAPI.getCurrentFilePath.mockResolvedValue({ success: true, result: '/sdcard/Notes/MyNote.note' });
    PluginCommAPI.getCurrentPageNum.mockResolvedValue({ success: true, result: 0 });
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

    expect(deleteSpy).toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/reader_shot_1000000000000.png');
    expect(deleteSpy).toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/temp_crop_page_1000000000000.png');
    expect(deleteSpy).toHaveBeenCalledWith('/sdcard/Supernote/Plugins/SnClipper/clip_1000000000000.png');
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
});
