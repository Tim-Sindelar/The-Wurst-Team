import { useContext } from 'react';
import { SocialDraftContext } from './draft';

export function useSocialDraft() {
  const value = useContext(SocialDraftContext);
  if (!value)
    throw new Error('Social draft must be inside its preview provider');
  return value;
}
