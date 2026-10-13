import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState, Button } from '../components/ui';
import { useT } from '../i18n';

export default function NotFoundPage() {
  const { t } = useT();
  return (
    <EmptyState
      icon={<Compass className="size-6" />}
      title={t('Page not found')}
      hint={t('The page you are looking for does not exist.')}
      action={
        <Link to="/">
          <Button variant="primary">{t('Go to dashboard')}</Button>
        </Link>
      }
    />
  );
}
