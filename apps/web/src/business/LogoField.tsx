import { useRef, useState } from 'react';
import { Notification } from '@gst/ui/notifications';
import { logoDataSchema, MAX_LOGO_BYTES } from '@gst/contracts';
export function LogoField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const request = useRef(0);
  const fileControl = useRef<HTMLInputElement>(null);
  return (
    <div className="logo-field">
      <input type="hidden" name="logoDataUrl" value={value} />
      <label>
        Business logo (PNG)
        <input
          ref={fileControl}
          type="file"
          accept="image/png"
          onChange={(event) => {
            const control = event.currentTarget;
            control.setCustomValidity('');
            const file = event.target.files?.[0];
            const selected = ++request.current;
            setError('');
            if (!file) return;
            if (file.size > MAX_LOGO_BYTES || file.type !== 'image/png') {
              setError('Choose a PNG file up to 64 KiB.');
              return;
            }
            control.setCustomValidity('Wait for the logo to finish loading.');
            void (async () => {
              const bitmap = await createImageBitmap(file);
              try {
                if (bitmap.width > 1024 || bitmap.height > 1024)
                  throw new Error('Logo dimensions exceed the limit');
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
                const normalized = canvas.toDataURL('image/png');
                if (!logoDataSchema.safeParse(normalized).success)
                  throw new Error('Invalid PNG');
                if (selected === request.current) setValue(normalized);
              } finally {
                bitmap.close();
              }
            })()
              .catch(() => {
                if (selected === request.current)
                  setError(
                    'Use a valid PNG up to 64 KiB and 1024 × 1024 pixels.',
                  );
              })
              .finally(() => {
                if (selected === request.current) control.setCustomValidity('');
              });
          }}
        />
      </label>
      <small>
        Printed on new invoices. Existing issued documents retain their saved
        logo.
      </small>
      {error && <Notification message={error} onDismiss={() => setError('')} />}
      {value && (
        <div>
          <img src={value} alt="Business logo preview" width="96" height="96" />
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              request.current++;
              fileControl.current?.setCustomValidity('');
              if (fileControl.current) fileControl.current.value = '';
              setValue('');
              setError('');
            }}
          >
            Remove logo
          </button>
        </div>
      )}
    </div>
  );
}
