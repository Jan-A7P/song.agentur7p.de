<?php

return [
    'required' => ':attribute ist erforderlich.',
    'email' => ':attribute muss eine gültige E-Mail-Adresse sein.',
    'unique' => ':attribute ist bereits vergeben.',
    'confirmed' => 'Die Bestätigung von :attribute stimmt nicht überein.',
    'min' => [
        'string' => ':attribute muss mindestens :min Zeichen haben.',
        'array' => ':attribute muss mindestens :min Elemente haben.',
        'numeric' => ':attribute muss mindestens :min sein.',
    ],
    'max' => [
        'string' => ':attribute darf höchstens :max Zeichen haben.',
        'file' => ':attribute darf höchstens :max Kilobyte groß sein.',
        'array' => ':attribute darf höchstens :max Elemente haben.',
        'numeric' => ':attribute darf höchstens :max sein.',
    ],
    'string' => ':attribute muss eine Zeichenkette sein.',
    'integer' => ':attribute muss eine ganze Zahl sein.',
    'uuid' => ':attribute muss eine gültige UUID sein.',
    'exists' => ':attribute ist ungültig.',
    'array' => ':attribute muss ein Array sein.',
    'distinct' => ':attribute enthält einen doppelten Wert.',
    'image' => ':attribute muss ein Bild sein.',
    'mimes' => ':attribute muss eine Datei des Typs :values sein.',
    'attributes' => [
        'email' => 'E-Mail',
        'password' => 'Passwort',
        'name' => 'Name',
        'title' => 'Titel',
        'artist' => 'Artist',
    ],
];
