-- l'indice « transfert de valeur » n'est plus émis : on retire ceux déjà enregistrés
DELETE FROM "AbuseSignal" WHERE "type" = 'FUNNEL';
