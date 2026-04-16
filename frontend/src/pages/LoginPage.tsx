import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { ApiError } from '../api/client';
import { toastApiError } from '../lib/toast';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (state.status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError('Не удалось войти');
      }
      toastApiError(err, 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center px-4 py-12'>
      <div className='glass w-full max-w-md rounded-2xl p-8 shadow-soft-lg'>
        <div className='mb-8 text-center'>
          <div className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-lg shadow-sky-500/30'>
            <span className='text-2xl font-bold'>M</span>
          </div>
          <h1 className='text-2xl font-bold text-slate-900 dark:text-white'>
            Вход
          </h1>
          <p className='mt-1 text-sm text-slate-500 dark:text-slate-400'>
            Внутренний портал отдела
          </p>
        </div>

        <form onSubmit={onSubmit} className='space-y-4'>
          <div>
            <label
              htmlFor='email'
              className='mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200'>
              Email
            </label>
            <input
              id='email'
              type='email'
              autoComplete='email'
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className='w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-slate-900 shadow-sm outline-none ring-sky-400/40 transition focus:border-sky-400 focus:ring-4 dark:border-slate-600 dark:bg-slate-800/90 dark:text-white'
            />
          </div>
          <div>
            <label
              htmlFor='password'
              className='mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200'>
              Пароль
            </label>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-slate-900 shadow-sm outline-none ring-sky-400/40 transition focus:border-sky-400 focus:ring-4 dark:border-slate-600 dark:bg-slate-800/90 dark:text-white'
            />
          </div>
          {error && (
            <p className='rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300'>
              {error}
            </p>
          )}
          <button
            type='submit'
            disabled={loading || state.status === 'loading'}
            className='w-full rounded-xl bg-gradient-to-r from-sky-500 to-sky-600 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:from-sky-600 hover:to-sky-700 disabled:opacity-60'>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
