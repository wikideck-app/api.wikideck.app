-- l'indice « manches répétées » n'est plus émis : on retire ceux déjà enregistrés
DELETE FROM "AbuseSignal" WHERE "type" = 'BATTLE_PAIR';
