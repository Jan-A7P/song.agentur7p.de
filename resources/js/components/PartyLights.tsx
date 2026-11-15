import { useEffect, useState } from 'react';
import { isPartyModeEnabled, PARTY_MODE_VISIBLE, subscribePartyMode } from '@/lib/party-mode';

export function PartyLights() {
    const [enabled, setEnabled] = useState(isPartyModeEnabled);

    useEffect(() => subscribePartyMode(setEnabled), []);

    if (!PARTY_MODE_VISIBLE || !enabled) {
        return null;
    }

    return (
        <div className="party-lights" aria-hidden>
            <div className="party-lights__wash" />
            <div className="party-lights__beam party-lights__beam--a" />
            <div className="party-lights__beam party-lights__beam--b" />
            <div className="party-lights__beam party-lights__beam--c" />
            <div className="party-lights__grid" />
            <div className="party-lights__strobe" />
            <div className="party-lights__flash" />
        </div>
    );
}
