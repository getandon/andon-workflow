import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { Button, Input, Card, CardHeader, CardTitle, CardContent } from '../components/ui';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { apiKey, setKey, isAuthenticated, init } = useAuthStore();
  const [key, setLocalKey] = useState('');

  useEffect(() => { init(); }, [init]);
  useEffect(() => { if (isAuthenticated) navigate({ to: '/' }); }, [isAuthenticated, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      setKey(key.trim());
      navigate({ to: '/' });
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-96">
        <CardHeader>
          <CardTitle>Andon Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="API Key"
              type="password"
              placeholder="Enter your API key"
              value={key}
              onChange={(e) => setLocalKey(e.target.value)}
            />
            <Button type="submit" className="w-full" disabled={!key.trim()}>
              Login
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
