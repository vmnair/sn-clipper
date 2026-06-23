import React from 'react';
import renderer, { act } from 'react-test-renderer';
import App from '../src/App';
import { ClipService } from '../src/services/ClipService';
import { Clipboard, ToastAndroid, Text, Pressable } from 'react-native';
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
      return fn;
    })(),
  };
});

jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    init: jest.fn(),
    registerButton: jest.fn(),
    registerButtonListener: jest.fn(),
    closePluginView: jest.fn(),
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
});
