1. good
2. recreated the issue of reliability
    In nvim:
    ```
    ::: a big pull quote in the middle of the page
    :::
    ```
    On the page:
    `::: a big pull quote in the middle of the pa :::`
    
    I cant find the trigger for this issue, but it seems like when the ghost text comes up, sometimes it stopstrying to create the preivew

    I got the preview with:
    ```
    ::: a big pull quote in teh middel of the page -> quote size=large
    ```

    BUT even after i saved it the words: 
    ```
    ::: a big pull quote in teh middel of the page -> quote size=large
    Hello world
    :::
    ```
    What is being rendered is this on the page:

    ```
    Hello wor
    ```

    which is what i was talkinmg about malformed text

3. I tried: 
    ```
    ::: a short note set apart from the page 
    ```
    But only one option, being `callout`


4. worked well
5. worked well
6. worked well
7. I had to stop testing here, same issues were happenign and need to be resolved

What is in nvim:
```
::: a short note for the reader -> callout kind=aside
Hello person
:::
```

what is in browser:

```
::: a short note for the reader -> callout kind=asid Hello person :::
```

What is in nvim:

```
::: a big quote -> quote size=large
Hello world
:::
```

what is in browser:

```
Hello wo
```
