import { createContext } from 'react';
export const AdminNoticeContext = createContext<{
  notice: string;
  setNotice: (message: string) => void;
} | null>(null);
