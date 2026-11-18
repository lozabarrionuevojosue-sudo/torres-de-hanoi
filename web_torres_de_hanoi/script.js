    const $ = (selector) => document.querySelector(selector)

    const TOWER_COUNT = 3
    const TOWER_LABELS = ['A', 'B', 'C']
    const GOAL_TOWER = 2
    const MIN_DISKS = 3
    const MAX_DISKS = 8
    const BASE_OFFSET = 36 
    const DRAG_THRESHOLD = 6

    let diskCount = 5
    let towers = [] 
    let moves = 0
    let selectedTower = null
    let drag = null
    let isAnimating = false

    let solving = false
    let paused = false
    let solveToken = 0
    let resumeSolver = null

    const board = $('#board')
    const diskElements = new Map() 

    
    function* hanoi(n, from, to, via) {
      if (n === 0) return 
      yield* hanoi(n - 1, from, via, to) 
      yield [from, to] 
      yield* hanoi(n - 1, via, to, from) 
    }

   
    function* solveFrom(n, to) {
      if (n === 0) return
      const from = towerOf(n)
      if (from === to) {
        yield* solveFrom(n - 1, to) 
        return
      }
      const via = TOWER_COUNT - from - to 
      yield* solveFrom(n - 1, via) 
      yield [from, to]
      yield* hanoi(n - 1, via, to, from) 
    }

    const towerOf = (disk) => towers.findIndex((tower) => tower.includes(disk))
    const topDisk = (index) => towers[index].at(-1)
    const minimumMoves = () => 2 ** diskCount - 1

    function isInitialState() {
      return towers[0].length === diskCount
    }

    function isSolved() {
      return towers[GOAL_TOWER].length === diskCount
    }


    function validateMove(from, to) {
      const disk = topDisk(from)
      if (disk === undefined) return 'Esa torre está vacía'
      const target = topDisk(to)
      if (target !== undefined && target < disk) return 'No puedes poner un disco sobre otro más pequeño'
      return ''
    }



    function getMetrics() {
      const width = board.clientWidth
      const height = board.clientHeight
      const slot = width / TOWER_COUNT
      const diskHeight = Math.min(30, (height * 0.72 - 10) / diskCount)
      return { width, height, slot, diskHeight }
    }

    function diskWidth(size, { slot }) {
      const min = slot * 0.3
      const max = slot * 0.92
      return min + ((size - 1) / Math.max(1, diskCount - 1)) * (max - min)
    }

    
    function diskPosition(size, tower, level, metrics = getMetrics()) {
      const width = diskWidth(size, metrics)
      const x = metrics.slot * tower + metrics.slot / 2 - width / 2
      const y = metrics.height - BASE_OFFSET - (level + 1) * metrics.diskHeight
      return { x, y }
    }

    const translate = ({ x, y }) => `translate(${x}px, ${y}px)`



    function createBoard() {
      board.querySelectorAll('.tower, .disk').forEach((element) => element.remove())
      diskElements.clear()

      TOWER_LABELS.forEach((label, index) => {
        const tower = document.createElement('div')
        tower.className = `tower ${index === GOAL_TOWER ? 'is-goal' : ''}`
        tower.style.left = `${(100 / TOWER_COUNT) * index}%`
        tower.dataset.label = index === GOAL_TOWER ? `${label} · META` : label
        tower.dataset.index = index
        board.append(tower)
      })

      for (let size = diskCount; size >= 1; size--) {
        const disk = document.createElement('div')
        disk.className = 'disk'
        disk.textContent = size
        disk.style.setProperty('--hue', 260 + (size - 1) * (220 / MAX_DISKS))
        board.append(disk)
        diskElements.set(size, disk)
      }
    }

    function layoutDisks() {
      const metrics = getMetrics()
      towers.forEach((tower, towerIndex) => {
        tower.forEach((size, level) => {
          const disk = diskElements.get(size)
          disk.style.width = `${diskWidth(size, metrics)}px`
          disk.style.height = `${metrics.diskHeight - 3}px`
          const position = diskPosition(size, towerIndex, level, metrics)
      
          if (towerIndex === selectedTower && level === tower.length - 1) position.y -= 18
          disk.style.transform = translate(position)
        })
      })
      board.querySelectorAll('.tower').forEach((tower, index) => {
        tower.classList.toggle('is-selected', index === selectedTower)
      })
    }

    function renderStats() {
      $('#moves').textContent = moves
      $('#minimum').textContent = minimumMoves()
      document.querySelectorAll('#disk-count button').forEach((button) => {
        button.setAttribute('aria-pressed', Number(button.dataset.count) === diskCount)
      })
      $('#solve').disabled = solving || isSolved()
      $('#pause').disabled = !solving
      $('#pause').textContent = paused ? '▶ Continuar' : '⏸ Pausar'
    }

    function setMessage(text, type = '') {
      const message = $('#message')
      message.className = 'message'
      void message.offsetWidth 
      if (type) message.classList.add(type)
      message.textContent = text
    }



    function moveDuration() {
      const speed = Number($('#speed').value)
      return 1100 / speed 
    }

    async function animateMove(from, to, startPosition = null) {
      const size = topDisk(from)
      const disk = diskElements.get(size)
      const metrics = getMetrics()
      const origin = startPosition ?? diskPosition(size, from, towers[from].length - 1, metrics)
      const target = diskPosition(size, to, towers[to].length, metrics)
      const liftY = Math.min(12, target.y - 30)

      const currentTransform = startPosition ? translate(origin) : disk.style.transform

      disk.style.transform = translate(target)
      const keyframes = startPosition
        ? [{ transform: currentTransform }, { transform: translate(target) }]
        : [
            { transform: currentTransform },
            { transform: translate({ x: origin.x, y: liftY }), offset: 0.3 },
            { transform: translate({ x: target.x, y: liftY }), offset: 0.7 },
            { transform: translate(target) }
          ]

      isAnimating = true
      try {
        await disk.animate(keyframes, {
          duration: startPosition ? 160 : moveDuration(),
          easing: 'ease-in-out'
        }).finished
      } catch {
        
      } finally {
        isAnimating = false
      }
    }

    function applyMove(from, to) {
      towers[to].push(towers[from].pop())
      moves++
      renderStats()
    }

    async function tryMove(from, to, startPosition = null) {
      selectedTower = null
      const error = validateMove(from, to)
      if (error) {
        setMessage(error, 'error')
        layoutDisks()
        return
      }

      await animateMove(from, to, startPosition)
      applyMove(from, to)
      layoutDisks()
      checkWin()
    }

    function checkWin() {
      if (!isSolved()) {
        setMessage(`Movimiento ${moves}. Mínimo posible: ${minimumMoves()}`)
        return
      }
      const perfect = moves === minimumMoves()
      setMessage(perfect
        ? `🏆 ¡Perfecto! Resuelto en el mínimo de ${moves} movimientos`
        : `🎉 ¡Resuelto en ${moves} movimientos! (el mínimo es ${minimumMoves()})`, 'win')
      renderStats()
    }


    async function solve() {
      if (solving || isSolved()) return
      const token = ++solveToken
      solving = true
      paused = false
      selectedTower = null
      layoutDisks()
      renderStats()

      const steps = isInitialState() ? hanoi(diskCount, 0, GOAL_TOWER, 1) : solveFrom(diskCount, GOAL_TOWER)
      setMessage('La recursión está resolviendo el puzle…')

      
      for (const [from, to] of steps) {
        if (paused) await new Promise((resolve) => { resumeSolver = resolve })
        if (token !== solveToken) return 
        await animateMove(from, to)
        if (token !== solveToken) return
        applyMove(from, to)
        layoutDisks()
        setMessage(`Disco ${topDisk(to)}: ${TOWER_LABELS[from]} → ${TOWER_LABELS[to]}`)
      }

      solving = false
      checkWin()
    }

    function togglePause() {
      if (!solving) return
      paused = !paused
      if (!paused) {
        resumeSolver?.()
        resumeSolver = null
      }
      renderStats()
    }

    function reset(count = diskCount) {
      solveToken++ 
      solving = false
      paused = false
      resumeSolver?.()
      resumeSolver = null
      board.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
      isAnimating = false

      diskCount = count
      moves = 0
      selectedTower = null
      towers = [Array.from({ length: diskCount }, (_, i) => diskCount - i), [], []]

      createBoard()
      layoutDisks()
      renderStats()
      setMessage('Haz clic en una torre y luego en otra, o arrastra el disco de arriba')
    }

    
    function towerAt(clientX) {
      const rect = board.getBoundingClientRect()
      const index = Math.floor(((clientX - rect.left) / rect.width) * TOWER_COUNT)
      return Math.max(0, Math.min(TOWER_COUNT - 1, index))
    }

    function selectTower(index) {
      if (selectedTower === null) {
        if (topDisk(index) === undefined) return setMessage('Esa torre está vacía', 'error')
        selectedTower = index
        setMessage(`Disco ${topDisk(index)} seleccionado: elige la torre de destino`)
        layoutDisks()
      } else if (selectedTower === index) {
        selectedTower = null
        layoutDisks()
      } else {
        tryMove(selectedTower, index)
      }
    }

    board.addEventListener('pointerdown', (event) => {
      if (solving || isAnimating) return
      const tower = towerAt(event.clientX)
      const size = topDisk(tower)
      drag = { tower, startX: event.clientX, startY: event.clientY, active: false, size }
      board.setPointerCapture(event.pointerId)
    })

    board.addEventListener('pointermove', (event) => {
      if (!drag || drag.size === undefined) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY

    
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        drag.active = true
        selectedTower = null
        layoutDisks()
        const disk = diskElements.get(drag.size)
        disk.classList.add('is-dragging')
        drag.origin = diskPosition(drag.size, drag.tower, towers[drag.tower].length - 1)
      }

      drag.position = { x: drag.origin.x + dx, y: drag.origin.y + dy }
      diskElements.get(drag.size).style.transform = translate(drag.position)
      board.querySelectorAll('.tower').forEach((element, index) => {
        element.classList.toggle('is-selected', index === towerAt(event.clientX))
      })
    })

    board.addEventListener('pointerup', async (event) => {
      if (!drag) return
      const current = drag
      drag = null

      if (!current.active) return selectTower(towerAt(event.clientX))

      diskElements.get(current.size).classList.remove('is-dragging')
      const target = towerAt(event.clientX)
      if (target === current.tower) return layoutDisks()
      await tryMove(current.tower, target, current.position)
    })

    board.addEventListener('pointercancel', () => {
      if (drag?.active) diskElements.get(drag.size).classList.remove('is-dragging')
      drag = null
      layoutDisks()
    })

    $('#disk-count').innerHTML = Array.from({ length: MAX_DISKS - MIN_DISKS + 1 }, (_, i) => {
      const count = MIN_DISKS + i
      return `<button data-count="${count}" aria-label="${count} discos">${count}</button>`
    }).join('')

    $('#disk-count').addEventListener('click', (event) => {
      const button = event.target.closest('button')
      if (button) reset(Number(button.dataset.count))
    })

    $('#reset').addEventListener('click', () => reset())
    $('#solve').addEventListener('click', solve)
    $('#pause').addEventListener('click', togglePause)

    document.addEventListener('keydown', (event) => {
      if (event.repeat || solving || isAnimating) return
      const index = Number(event.key) - 1
      if (index >= 0 && index < TOWER_COUNT) selectTower(index)
    })

    window.addEventListener('resize', layoutDisks)

    reset(5)
 