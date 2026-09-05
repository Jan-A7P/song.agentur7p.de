<?php

return [
    'required' => 'The :attribute field is required.',
    'email' => 'The :attribute must be a valid email address.',
    'unique' => 'The :attribute has already been taken.',
    'confirmed' => 'The :attribute confirmation does not match.',
    'min' => [
        'string' => 'The :attribute must be at least :min characters.',
        'array' => 'The :attribute must have at least :min items.',
        'numeric' => 'The :attribute must be at least :min.',
    ],
    'max' => [
        'string' => 'The :attribute may not be greater than :max characters.',
        'file' => 'The :attribute may not be greater than :max kilobytes.',
        'array' => 'The :attribute may not have more than :max items.',
        'numeric' => 'The :attribute may not be greater than :max.',
    ],
    'string' => 'The :attribute must be a string.',
    'integer' => 'The :attribute must be an integer.',
    'uuid' => 'The :attribute must be a valid UUID.',
    'exists' => 'The selected :attribute is invalid.',
    'array' => 'The :attribute must be an array.',
    'distinct' => 'The :attribute field has a duplicate value.',
    'image' => 'The :attribute must be an image.',
    'mimes' => 'The :attribute must be a file of type: :values.',
    'attributes' => [
        'email' => 'email',
        'password' => 'password',
        'name' => 'name',
        'title' => 'title',
        'artist' => 'artist',
    ],
];
