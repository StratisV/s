import { render } from '@testing-library/react';
import { EmojiText } from './EmojiText';

describe('EmojiText', () => {
  it('draws the duck and the hedgehog, keeping the characters in the text', () => {
    const { container } = render(
      <p>
        <EmojiText text="🦆 Shea and 🦔 Stratis" />
      </p>,
    );
    expect(container.textContent).toBe('🦆 Shea and 🦔 Stratis');
    const drawn = container.querySelectorAll<HTMLElement>('[data-drawn]');
    expect([...drawn].map((el) => el.dataset.drawn)).toEqual(['duck', 'hedgehog']);
    for (const el of drawn) expect(el.style.getPropertyValue('--drawn')).toMatch(/^url\("data:image\/svg\+xml/);
  });

  it('leaves other emoji and plain text alone', () => {
    const { container } = render(
      <p>
        <EmojiText text="🦊 Ela" />
      </p>,
    );
    expect(container.innerHTML).toBe('<p>🦊 Ela</p>');
  });
});
