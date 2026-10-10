import { ActionIcon } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { DiceIcon } from '../DiceIcon';
import { randomDiceFaces, type DiceFaces } from '../diceFaces';

const ROLL_MS = 420;

type DiceButtonProps = {
  disabled?: boolean;
  /** Called on every roll; the screen picks the seat. */
  onRoll: () => void;
};

/* The "choose any free seat" button: a die that pulses gently, tumbles when
   tapped and lands on new faces halfway through the roll. */
export function DiceButton({ disabled = false, onRoll }: DiceButtonProps) {
  const [faces, setFaces] = useState<DiceFaces>([1, 2, 3]);
  const [roll, setRoll] = useState(0);
  const timer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rollDice = () => {
    onRoll();
    setRoll((count) => count + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setFaces(randomDiceFaces()),
      ROLL_MS / 2,
    );
  };

  return (
    <ActionIcon
      variant="fab"
      className="group pointer-events-auto mr-3 last:mb-3"
      aria-label="Choose any free seat"
      title="Choose any free seat"
      disabled={disabled}
      onClick={rollDice}
    >
      <DiceIcon
        key={roll}
        faces={faces}
        className={`size-14 group-data-disabled:animate-none ${roll > 0 ? 'animate-dice-roll' : 'animate-pulse-soft'}`}
      />
    </ActionIcon>
  );
}
