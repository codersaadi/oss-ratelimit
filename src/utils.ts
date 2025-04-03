import { RatelimitError } from './index';
import { TimeWindow } from './types';

// Parse time window to milliseconds with proper error handling
export const parseTimeWindow = (window: TimeWindow): number => {
  try {
    const [valueStr, unit] = window.split(' ');
    const value = Number.parseInt(valueStr || 's', 10);

    if (Number.isNaN(value) || value <= 0) {
      throw new RatelimitError(`Invalid time value: ${valueStr}`);
    }

    switch (unit) {
      case 'ms':
        return value;
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        throw new RatelimitError(`Invalid time unit: ${unit}`);
    }
  } catch (error) {
    if (error instanceof RatelimitError) throw error;
    throw new RatelimitError(`Failed to parse time window: ${window}`);
  }
};
