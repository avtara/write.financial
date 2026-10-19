// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Button, Field, FormError, FormNotice, Select, TextInput } from './form.tsx';

describe('Field', () => {
  it('labels its control and links the hint', async () => {
    const screen = await render(
      <Field label="Email" aside={<a href="/forgot">Lupa?</a>} hint="Kami tidak membagikannya">
        {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    await expect.element(input).toHaveAccessibleDescription('Kami tidak membagikannya');
    await expect.element(input).toHaveAttribute('aria-invalid', 'false');
    await expect.element(screen.getByRole('link', { name: 'Lupa?' })).toBeVisible();
  });

  it('announces an error instead of the hint', async () => {
    const screen = await render(
      <Field label="Email" hint="hint" error="Email salah">
        {({ id, describedBy, invalid }) => (
          <TextInput id={id} size="sm" aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Email' });
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Email salah');
    await expect.element(input).toHaveAccessibleDescription('Email salah');
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await expect.element(screen.getByText('hint')).not.toBeInTheDocument();
  });

  it('has no description without hint or error', async () => {
    const screen = await render(
      <Field label="Nama">{({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} />}</Field>,
    );
    await expect.element(screen.getByRole('textbox', { name: 'Nama' })).not.toHaveAttribute('aria-describedby');
  });
});

describe('Select', () => {
  it('renders its options in both sizes', async () => {
    const screen = await render(
      <>
        <Select aria-label="Besar" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
        <Select aria-label="Kecil" size="sm">
          <option value="a">A</option>
        </Select>
      </>,
    );
    await expect.element(screen.getByRole('combobox', { name: 'Besar' })).toHaveValue('b');
    await expect.element(screen.getByRole('combobox', { name: 'Kecil' })).toHaveClass('h-8');
  });
});

describe('Button', () => {
  it('is a plain button by default and clicks', async () => {
    const onClick = vi.fn();
    const screen = await render(<Button onClick={onClick}>Simpan</Button>);
    const button = screen.getByRole('button', { name: 'Simpan' });
    await expect.element(button).toHaveAttribute('type', 'button');
    await expect.element(button).toHaveAttribute('aria-busy', 'false');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is busy and disabled while pending, in every variant and size', async () => {
    const screen = await render(
      <>
        <Button pending variant="secondary" size="sm">
          A
        </Button>
        <Button disabled variant="destructive" type="submit">
          B
        </Button>
        <Button variant="ghost">C</Button>
      </>,
    );
    await expect.element(screen.getByRole('button', { name: 'A' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-busy', 'true');
    await expect.element(screen.getByRole('button', { name: 'B' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'B' })).toHaveAttribute('type', 'submit');
    await expect.element(screen.getByRole('button', { name: 'C' })).toBeEnabled();
  });
});

describe('FormError and FormNotice', () => {
  it('announce errors as alerts and notes as status', async () => {
    const screen = await render(
      <>
        <FormError>Akun dikunci</FormError>
        <FormNotice>Email terkirim</FormNotice>
      </>,
    );
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Akun dikunci');
    await expect.element(screen.getByRole('status')).toHaveTextContent('Email terkirim');
  });
});
