export const pushTranslations: Record<string, Record<string, { title: string; body: string }>> = {
    proposal_remixed: {
        en: { title: "Your idea was remixed 💡", body: '"{remixTitle}" was created from your idea.' },
        de: { title: "Deine Idee wurde geremixt 💡", body: '"{remixTitle}" wurde aus deiner Idee erstellt.' }
    },
    vote_migration: {
        en: { title: "New remix available 🌿", body: 'A new version of "{parentTitle}" is available. Compare the changes.' },
        de: { title: "Neuer Remix verfügbar 🌿", body: 'Eine neue Version von "{parentTitle}" ist verfügbar. Vergleiche die Änderungen.' }
    },
    phase_change_Closing: {
        en: { title: "Closing soon ⏳", body: '"{questionTitle}" is entering the closing window. Finalize your support.' },
        de: { title: "Bald geschlossen ⏳", body: '"{questionTitle}" geht in die Abschlussphase. Lege deine Unterstützung fest.' }
    },
    phase_change_Voting: {
        en: { title: "Vote now 🗳️", body: 'Cast your final vote on "{questionTitle}".' },
        de: { title: "Jetzt abstimmen 🗳️", body: 'Gib deine finale Stimme für "{questionTitle}" ab.' }
    },
    survey_unlocked: {
        en: { title: "Fill out the study survey 📋", body: "Thank you for participating! Please complete the study survey." },
        de: { title: "Studienbefragung ausfüllen 📋", body: "Danke für deine Teilnahme! Bitte fülle die Befragung aus." }
    },
    ballot_entry: {
        en: { title: "On the ballot! 🎯", body: 'An idea you support ("{proposalTitle}") made it to the ballot.' },
        de: { title: "Auf der Abstimmungsliste! 🎯", body: 'Eine Idee, die du unterstützt ("{proposalTitle}"), hat es auf die Abstimmungsliste geschafft.' }
    },
    phase_halfway_AnswerSearch: {
        en: { title: "Discussion halfway through ⏳", body: '"{questionTitle}" is halfway through the discussion phase. Share your ideas before time runs out!' },
        de: { title: "Diskussion zur Hälfte ⏳", body: '„{questionTitle}" ist zur Hälfte der Diskussionsphase. Teile deine Ideen, bevor die Zeit abläuft!' }
    },
    phase_halfway_Closing: {
        en: { title: "Closing window half over ⏰", body: 'The closing window for "{questionTitle}" is half over. Finalize your support now!' },
        de: { title: "Abschlussphase zur Hälfte ⏰", body: 'Die Abschlussphase für „{questionTitle}" ist zur Hälfte vorbei. Lege jetzt deine Unterstützung fest!' }
    },
    phase_halfway_Voting: {
        en: { title: "Voting halfway done 🗳️", body: 'Voting on "{questionTitle}" is halfway done. Cast your ballot if you haven\'t yet!' },
        de: { title: "Abstimmung zur Hälfte 🗳️", body: 'Die Abstimmung über „{questionTitle}" ist zur Hälfte vorbei. Gib deine Stimme ab!' }
    },
    phase_ending_soon_AnswerSearch: {
        en: { title: "Discussion ending soon 🔔", body: 'Less than 24 hours left to contribute to "{questionTitle}". Add or improve ideas now!' },
        de: { title: "Diskussion endet bald 🔔", body: 'Weniger als 24 Stunden, um zu „{questionTitle}" beizutragen. Füge jetzt Ideen hinzu oder verbessere sie!' }
    },
    phase_ending_soon_Closing: {
        en: { title: "Closing in a few hours ⚡", body: '"{questionTitle}" closes soon. Make sure your support is set!' },
        de: { title: "Schliesst in wenigen Stunden ⚡", body: '„{questionTitle}" schliesst bald. Stelle sicher, dass deine Unterstützung steht!' }
    },
    phase_ending_soon_Voting: {
        en: { title: "Last chance to vote! 🏁", body: 'Voting on "{questionTitle}" ends soon. Don\'t miss your chance to decide!' },
        de: { title: "Letzte Chance zur Abstimmung! 🏁", body: 'Die Abstimmung zu „{questionTitle}" endet bald. Verpasse nicht deine Chance mitzuentscheiden!' }
    }
};
