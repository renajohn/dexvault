import React, { useState } from 'react';
import { Form } from 'react-bootstrap';
import { BsSpeaker } from 'react-icons/bs';
import Dialog from './shared/Dialog';
import Button from './shared/Button';
import { FieldError, FieldHint, TextField } from './shared/TextField';
import outputs, { type Output } from '../services/outputs';
import toast from './shared/Toast';

/**
 * An appliance's settings: the name DexVault shows it by (empty: its own),
 * and the volume DexVault never sends it above.
 */
const OutputSettings: React.FC<{ output: Output; onClose: () => void }> = ({ output, onClose }) => {
  const [name, setName] = useState(output.name === output.deviceName ? '' : output.name);
  const [ceiling, setCeiling] = useState(String(output.maxVolume));
  const [saving, setSaving] = useState(false);
  const value = Number(ceiling);
  const valid = ceiling.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 100;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await outputs.settings(output.id, { name: name.trim() || null, maxVolume: value });
      onClose();
    } catch (error) {
      toast(`Could not keep the settings: ${(error as Error).message}`, { tone: 'danger' });
      setSaving(false);
    }
  };

  return (
    <Dialog show onClose={onClose} size="sm" icon={<BsSpeaker />} title={`${output.name} settings`} aside={output.model || undefined}>
      <Dialog.Body>
        <Form onSubmit={event => { event.preventDefault(); void save(); }}>
          <Form.Group className="mb-3" controlId="output-name">
            <Form.Label>Name</Form.Label>
            <TextField value={name} placeholder={output.deviceName || output.name} maxLength={40} autoFocus
              onChange={event => setName(event.target.value)} />
            <FieldHint>Empty: its own name{output.deviceName ? `, “${output.deviceName}”` : ''}.</FieldHint>
          </Form.Group>
          <Form.Group controlId="output-ceiling">
            <Form.Label>Volume ceiling</Form.Label>
            <TextField type="number" inputMode="numeric" min={0} max={100} step={1} value={ceiling} suffix="of 100" isInvalid={!valid}
              onChange={event => setCeiling(event.target.value)} />
            <FieldError>{!valid && 'A whole number from 0 to 100.'}</FieldError>
            <FieldHint>DexVault never sets the volume above it.</FieldHint>
          </Form.Group>
        </Form>
      </Dialog.Body>
      <Dialog.Footer>
        <span style={{ flex: 1 }} />
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!valid} onClick={save}>Save</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default OutputSettings;
