// Echte React-Komponenten: Radix Select (Basis von shadcn/ui) und react-select
import { createRoot } from 'react-dom/client';
import * as Select from '@radix-ui/react-select';
import ReactSelect from 'react-select';

const plans = ['Basic', 'Business', 'Enterprise'];
const cities = [
  { value: 'berlin', label: 'Berlin' },
  { value: 'hamburg', label: 'Hamburg' },
  { value: 'munich', label: 'Munich' },
];

function App() {
  return (
    <form onSubmit={(e) => { e.preventDefault(); window.submits = (window.submits || 0) + 1; }}>
      <h2>Radix Select</h2>
      <label id="plan-label">Plan</label>
      <Select.Root defaultValue="Business">
        <Select.Trigger id="radix-select" aria-labelledby="plan-label"><Select.Value /></Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper">
            <Select.Viewport>
              {plans.map((p) => (
                <Select.Item key={p} value={p}><Select.ItemText>{p}</Select.ItemText></Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      <h2>react-select</h2>
      <label htmlFor="react-select-input">City</label>
      <ReactSelect inputId="react-select-input" options={cities} defaultValue={cities[1]} />
      <button type="submit">Save</button>
    </form>
  );
}

createRoot(document.getElementById('app')).render(<App />);
