import { renderApp } from '@/ui/app';
import { UserService } from '@/services/userService';

export const app = {
  start() {
    const users = new UserService();
    renderApp(users);
  },
};
