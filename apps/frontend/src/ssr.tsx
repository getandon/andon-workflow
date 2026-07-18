import { RouterProvider, StartServer } from '@tanstack/react-start';
import { router } from './router';

export function ServerApp() {
  return (
    <StartServer router={router}>
      <RouterProvider router={router} />
    </StartServer>
  );
}
