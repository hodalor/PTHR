import { render, screen } from '@testing-library/react';
import App from './App';

test('renders login screen when not authenticated', () => {
  render(<App />);
  expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();
});
