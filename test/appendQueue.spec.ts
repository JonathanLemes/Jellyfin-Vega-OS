jest.mock('@amazon-devices/react-native-w3cmedia', () => ({AppendMode: {segments: 'segments'}}));

import {AppendQueue} from '../src/player/appendQueue';

class FakeSourceBuffer {
  mode = '';
  updating = false;
  onupdateend?: () => void;
  onerror?: () => void;
  full = false;
  log: string[] = [];
  appendBuffer(data: ArrayBuffer) {
    if (this.full) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.log.push(`append ${data.byteLength}`);
    this.updating = true;
  }
  remove(start: number, end: number) {
    this.log.push(`remove ${start}-${end}`);
    this.full = false;
    this.updating = true;
  }
  finish() {
    this.updating = false;
    this.onupdateend?.();
  }
}

function setup() {
  const sb = new FakeSourceBuffer();
  const onError = jest.fn();
  const onQuotaExceeded = jest.fn();
  const queue = new AppendQueue(sb as never, {onError, onQuotaExceeded});
  return {sb, queue, onError, onQuotaExceeded};
}

describe('AppendQueue', () => {
  it('treats a full buffer as recoverable and retries the same append', () => {
    const {sb, queue, onError, onQuotaExceeded} = setup();
    sb.full = true;
    queue.push(new ArrayBuffer(10));
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(queue.blocked).toBe(true);
    expect(queue.idle).toBe(false);

    expect(queue.evictUrgently([{start: 0, end: 20}])).toBe(true);
    expect(sb.log).toEqual(['remove 0-20']);
    sb.finish();
    // The append that did not fit goes in, so the timeline has no hole.
    expect(sb.log).toEqual(['remove 0-20', 'append 10']);
    sb.finish();
    expect(queue.idle).toBe(true);
  });

  it('stays blocked when there is nothing to evict', () => {
    const {sb, queue} = setup();
    sb.full = true;
    queue.push(new ArrayBuffer(10));
    expect(queue.evictUrgently([])).toBe(false);
    expect(queue.blocked).toBe(true);
  });

  it('drops a blocked append on seek', () => {
    const {sb, queue} = setup();
    sb.full = true;
    queue.push(new ArrayBuffer(10));
    queue.dropQueued();
    expect(queue.blocked).toBe(false);
    expect(queue.idle).toBe(true);
  });

  it('reports other append failures as fatal', () => {
    const {sb, queue, onError} = setup();
    sb.appendBuffer = () => {
      throw new Error('boom');
    };
    queue.push(new ArrayBuffer(1));
    expect(onError).toHaveBeenCalledWith('The device could not buffer this stream: boom');
  });
});
