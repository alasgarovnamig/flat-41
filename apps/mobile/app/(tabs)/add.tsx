import { Redirect } from 'expo-router';

/** Placeholder route for the centre "+" tab — the tab button opens /post directly. */
export default function AddPlaceholder() {
  return <Redirect href="/post" />;
}
