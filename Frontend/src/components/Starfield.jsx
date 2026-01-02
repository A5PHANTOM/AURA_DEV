import React from 'react';

const Starfield = () => {
  const starfieldStyles = `
    @keyframes move-stars {
      from { transform: translateY(0px); }
      to { transform: translateY(-2000px); }
    }
    @keyframes meteor-fall {
        0% {
            transform: translate3d(500px, -300px, 0) rotate(215deg);
            opacity: 1;
        }
        70% {
            opacity: 1;
        }
        100% {
            transform: translate3d(-2000px, 2000px, 0) rotate(215deg);
            opacity: 0;
        }
    }

    .stars-bg {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 200%;
      display: block;
      z-index: 0;
    }

    .stars1 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="200" cy="200" r="1.5"/><circle fill="%23fff" cx="500" cy="800" r="1"/><circle fill="%23fff" cx="900" cy="300" r="1.2"/><circle fill="%23fff" cx="1200" cy="1100" r="1"/><circle fill="%23fff" cx="1500" cy="600" r="1.5"/><circle fill="%23fff" cx="1800" cy="1400" r="0.8"/><circle fill="%23fff" cx="100" cy="1500" r="1.1"/><circle fill="%23fff" cx="800" cy="1800" r="1.3"/><circle fill="%23fff" cx="1300" cy="100" r="1"/><circle fill="%23fff" cx="1600" cy="900" r="0.9"/></svg>');
      animation: move-stars 150s linear infinite;
    }
    .stars2 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="300" cy="500" r="1"/><circle fill="%23fff" cx="600" cy="100" r="1.2"/><circle fill="%23fff" cx="1000" cy="900" r="0.8"/><circle fill="%23fff" cx="1400" cy="1300" r="1.5"/><circle fill="%23fff" cx="1700" cy="200" r="1.1"/><circle fill="%23fff" cx="400" cy="1600" r="1.3"/><circle fill="%23fff" cx="900" cy="1900" r="0.7"/><circle fill="%23fff" cx="1100" cy="1500" r="1.4"/><circle fill="%23fff" cx="1900" cy="800" r="1"/></svg>');
      animation: move-stars 100s linear infinite;
    }
    .stars3 {
      background: transparent url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><circle fill="%23fff" cx="100" cy="600" r="0.8"/><circle fill="%23fff" cx="400" cy="200" r="1"/><circle fill="%23fff" cx="800" cy="1100" r="1.2"/><circle fill="%23fff" cx="1100" cy="1600" r="0.9"/><circle fill="%23fff" cx="1500" cy="300" r="1.1"/><circle fill="%23fff" cx="1900" cy="1200" r="1.3"/><circle fill="%23fff" cx="250" cy="1800" r="0.7"/><circle fill="%23fff" cx="700" cy="1400" r="1.4"/><circle fill="%23fff" cx="1300" cy="700" r="1"/></svg>');
      animation: move-stars 50s linear infinite;
    }

    .meteor {
        position: absolute;
        width: 300px;
        height: 1px;
        background: linear-gradient(to right, rgba(255, 255, 255, 0.8), transparent);
        animation: meteor-fall 8s linear infinite;
    }
  `;

  return (
    <>
      <style>{starfieldStyles}</style>
      <div className="stars-bg stars1"></div>
      <div className="stars-bg stars2"></div>
      <div className="stars-bg stars3"></div>
      <div className="meteor" style={{ top: '100px', left: '-200px', animationDelay: '0s' }}></div>
      <div className="meteor" style={{ top: '300px', left: '0px', animationDelay: '1.4s' }}></div>
      <div className="meteor" style={{ top: '500px', left: '200px', animationDelay: '5.8s' }}></div>
    </>
  );
};

export default Starfield;
