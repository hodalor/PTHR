import { readFileAsDataUrl, readFileForStorage } from './fileUpload';

describe('fileUpload', () => {
  const OriginalFileReader = global.FileReader;
  const OriginalImage = global.Image;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    global.FileReader = OriginalFileReader;
    global.Image = OriginalImage;
    document.createElement = originalCreateElement;
  });

  test('reads non-image files as data URLs', async () => {
    const readAsDataURL = jest.fn();
    global.FileReader = class {
      constructor() {
        this.result = 'data:text/plain;base64,Zm9v';
      }
      readAsDataURL(file) {
        readAsDataURL(file);
        this.onload();
      }
    };

    const file = { name: 'note.txt', type: 'text/plain' };
    await expect(readFileAsDataUrl(file)).resolves.toBe('data:text/plain;base64,Zm9v');
    expect(readAsDataURL).toHaveBeenCalledWith(file);
    await expect(readFileForStorage(file)).resolves.toBe('data:text/plain;base64,Zm9v');
  });

  test('rejects when file reading fails', async () => {
    global.FileReader = class {
      readAsDataURL() {
        this.onerror();
      }
    };

    await expect(readFileAsDataUrl({ name: 'broken.png', type: 'image/png' })).rejects.toThrow(
      'Unable to read broken.png'
    );
  });

  test('compresses supported images through canvas when available', async () => {
    global.FileReader = class {
      constructor() {
        this.result = 'data:image/png;base64,source';
      }
      readAsDataURL() {
        this.onload();
      }
    };

    const drawImage = jest.fn();
    const toDataURL = jest.fn(() => 'data:image/jpeg;base64,compressed');
    const getContext = jest.fn(() => ({ drawImage }));
    document.createElement = jest.fn((tagName) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext,
          toDataURL,
        };
      }
      return originalCreateElement(tagName);
    });

    global.Image = class {
      constructor() {
        this.width = 2000;
        this.height = 1000;
      }
      set src(value) {
        this._src = value;
        this.onload();
      }
    };

    await expect(readFileForStorage({ name: 'photo.png', type: 'image/png' })).resolves.toBe(
      'data:image/jpeg;base64,compressed'
    );
    expect(drawImage).toHaveBeenCalled();
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
  });

  test('falls back to the original image data when canvas context is unavailable', async () => {
    global.FileReader = class {
      constructor() {
        this.result = 'data:image/png;base64,source';
      }
      readAsDataURL() {
        this.onload();
      }
    };

    document.createElement = jest.fn((tagName) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => null,
          toDataURL: jest.fn(),
        };
      }
      return originalCreateElement(tagName);
    });

    global.Image = class {
      constructor() {
        this.width = 100;
        this.height = 100;
      }
      set src(value) {
        this._src = value;
        this.onload();
      }
    };

    await expect(readFileForStorage({ name: 'photo.png', type: 'image/png' })).resolves.toBe(
      'data:image/png;base64,source'
    );
  });

  test('falls back to the original image data when image loading fails', async () => {
    global.FileReader = class {
      constructor() {
        this.result = 'data:image/png;base64,source';
      }
      readAsDataURL() {
        this.onload();
      }
    };

    global.Image = class {
      set src(value) {
        this._src = value;
        this.onerror();
      }
    };

    await expect(readFileForStorage({ name: 'photo.png', type: 'image/png' })).resolves.toBe(
      'data:image/png;base64,source'
    );
  });
});
