import React from 'react';
import renderer, { act } from 'react-test-renderer';
import App from '../src/App';
import { ClipService } from '../src/services/ClipService';
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
  },
  FileUtils: {
    deleteFile: jest.fn().mockResolvedValue(true),
  },
  NativePluginManager: {
    invalidatePluginView: jest.fn(),
  },
}));

describe('App Component', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
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

  it('inserts all visible clips sequentially into active note', async () => {
    const { PluginNoteAPI, PluginFileAPI } = require('sn-plugin-lib');
    PluginFileAPI.getElements
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            type: 500,
            textBox: { textRect: { left: 100, top: 100, right: 1304, bottom: 200 } },
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        result: [
          {
            uuid: 'mock-uuid',
            type: 200,
            picture: { rect: { left: 0, top: 0, right: 300, bottom: 300 } },
          },
        ],
      });

    await ClipService.addClip('Test highlight textbox', 'Doc A');
    await ClipService.addImageClip('/path/to/clip.png', 'Doc A');

    const root = await renderApp();

    const insertBtn = root.root.findByProps({ label: 'Insert into open Note' });
    await act(async () => {
      await insertBtn.props.onPress();
    });

    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    expect(PluginNoteAPI.insertImage).toHaveBeenCalledWith('/path/to/clip.png');
    expect(PluginFileAPI.modifyElements).toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith('Clips inserted successfully!', ToastAndroid.SHORT);
  });

  it('displays warning toast when clips do not fit on active note page', async () => {
    const { PluginFileAPI, PluginNoteAPI } = require('sn-plugin-lib');
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

    expect(PluginNoteAPI.insertText).toHaveBeenCalled();
    expect(ToastAndroid.show).toHaveBeenCalledWith(
      'Warning: Selected clips may exceed page bounds.',
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

    expect(PluginNoteAPI.insertText).toHaveBeenCalledWith(expect.objectContaining({
      textRect: expect.objectContaining({ bottom: 330 })
    }));
  });

  it('inserts selected clips sequentially into active note', async () => {
    const { PluginNoteAPI } = require('sn-plugin-lib');
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

  it('shows the header capture button when a page is open and enters crop on press', async () => {
    // Default mock provides a currentFilePath, so the capture button should render.
    const root = await renderApp();

    const captureBtn = root.root.findByProps({ testID: 'capture-btn' });
    expect(captureBtn).toBeTruthy();

    await act(async () => {
      captureBtn.props.onPress();
    });
    // Flush the async page capture inside handleStartCropping.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Crop workspace should now be mounted (the only element with onLayout).
    const workspace = root.root.find((el) => typeof el.props.onLayout === 'function');
    expect(workspace).toBeTruthy();
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
});
