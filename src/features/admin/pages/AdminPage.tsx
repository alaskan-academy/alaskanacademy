import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/configuracoes', { replace: true });
  }, [navigate]);

  return null;
}
