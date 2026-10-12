// Echte Vue-Komponenten: Headless UI Listbox, Reka UI Select und Combobox
import { createApp, ref } from 'vue/dist/vue.esm-bundler.js';
import { Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions } from '@headlessui/vue';
import {
  ComboboxAnchor, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxRoot, ComboboxViewport,
  SelectContent, SelectItem, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport,
} from 'reka-ui';

createApp({
  components: {
    Listbox, ListboxButton, ListboxLabel, ListboxOption, ListboxOptions,
    SelectRoot, SelectTrigger, SelectValue, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText,
    ComboboxRoot, ComboboxAnchor, ComboboxInput, ComboboxContent, ComboboxViewport, ComboboxItem,
  },
  setup() {
    return {
      country: ref('Germany'),
      countries: ['Germany', 'Austria', 'Switzerland'],
      protocol: ref('TCP'),
      protocols: ['UDP', 'TCP', 'TLS'],
      city: ref('Berlin'),
      cities: ['Berlin', 'Hamburg', 'Munich'],
      submits: ref(0),
    };
  },
  template: `
    <form @submit.prevent="submits++; window.submits = submits">
      <h2>Headless UI</h2>
      <Listbox v-model="country">
        <ListboxLabel>Country</ListboxLabel>
        <ListboxButton id="hui-button">{{ country }}</ListboxButton>
        <ListboxOptions>
          <ListboxOption v-for="c in countries" :key="c" :value="c">{{ c }}</ListboxOption>
        </ListboxOptions>
      </Listbox>

      <h2>Reka Select</h2>
      <label id="protocol-label">Protocol</label>
      <SelectRoot v-model="protocol">
        <SelectTrigger id="reka-select" aria-labelledby="protocol-label"><SelectValue /></SelectTrigger>
        <SelectPortal>
          <SelectContent position="popper">
            <SelectViewport>
              <SelectItem v-for="p in protocols" :key="p" :value="p"><SelectItemText>{{ p }}</SelectItemText></SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>

      <h2>Reka Combobox</h2>
      <ComboboxRoot v-model="city">
        <ComboboxAnchor>
          <ComboboxInput id="reka-combobox" aria-label="City" :display-value="(v) => v" />
        </ComboboxAnchor>
        <ComboboxContent>
          <ComboboxViewport>
            <ComboboxItem v-for="c in cities" :key="c" :value="c">{{ c }}</ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxRoot>
      <button type="submit">Save</button>
    </form>`,
}).mount('#app');
