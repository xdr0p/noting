import { useState, useEffect, memo } from 'react';

const Clock = memo(function Clock() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="status-bar-left">
      {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </div>
  );
});

interface StatusBarProps {
  zoomLevel: number;
  cursorLine: number;
  cursorCol: number;
  selectedWords: number;
  words: number;
  chars: number;
}

export const StatusBar = memo(function StatusBar({
  zoomLevel,
  cursorLine,
  cursorCol,
  selectedWords,
  words,
  chars,
}: StatusBarProps) {
  return (
    <div className="status-bar-row">
      <Clock />

      <div className="status-bar">
        <span>{zoomLevel}%</span>
        <span className="status-divider">|</span>
        <span title="Line = top-level block index (a list counts as one block)">
          Ln {cursorLine}, Col {cursorCol}
        </span>
        <span className="status-divider">|</span>
        <span>
          {selectedWords > 0 ? `${selectedWords} of ` : ''}
          {words} words ({chars} chars)
        </span>
      </div>
    </div>
  );
});
