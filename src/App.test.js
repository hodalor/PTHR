import { render, screen } from '@testing-library/react';
import App from './App';

test('renders pthr workspace heading', () => {
  render(<App />);
  const headingElement = screen.getByText(/pthr hr management workspace/i);
  expect(headingElement).toBeInTheDocument();
});
